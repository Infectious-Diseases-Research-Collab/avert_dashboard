import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";

/** Outstanding vaccine-coverage verification list: need_vac_cov=1 with no
 *  matching vaccination_status record, and not waived by a clinic. This is the
 *  actionable follow-up list, so it must not hand back visits somebody has
 *  already decided aren't needed. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const mrc = searchParams.get("mrc");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // The generated client can't infer a "raw->>field" alias, so it widens the
  // row type; the shape is known here and asserted rather than inferred.
  type Row = {
    uniqueid: string;
    barcode: string | null;
    vx_card_no: string | null;
    vx_card_no_oth: string | null;
  };

  // PostgREST caps every response at this project's ~1,000-row "Max Rows"
  // setting regardless of `.limit()`, so all three queries have to be paged
  // through with fetchAllRows (see the same fix in src/app/dashboard/page.tsx).
  let needing: Row[];
  let covered: { barcode: string }[];
  let waivers: { uniqueid: string; required: boolean }[];
  try {
    [needing, covered, waivers] = await Promise.all([
      fetchAllRows<Row>((rangeFrom, rangeTo) => {
        let query = supabase
          .from("enrollee")
          .select(
            "uniqueid,country,subjid,barcode,mrc,startdate," +
              "vx_card_no:raw->>vx_card_no,vx_card_no_oth:raw->>vx_card_no_oth",
          )
          .eq("need_vac_cov", 1);
        if (country) query = query.eq("country", country);
        if (mrc) query = query.eq("mrc", mrc);
        if (from) query = query.gte("startdate", from);
        if (to) query = query.lte("startdate", to);
        return query.range(rangeFrom, rangeTo) as unknown as PromiseLike<PageResult<Row>>;
      }),
      fetchAllRows<{ barcode: string }>((rangeFrom, rangeTo) =>
        supabase.from("vaccination_status").select("barcode").range(rangeFrom, rangeTo),
      ),
      fetchAllRows<{ uniqueid: string; required: boolean }>((rangeFrom, rangeTo) =>
        supabase.from("verification_waivers").select("uniqueid,required").range(rangeFrom, rangeTo),
      ),
    ]);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const done = new Set(covered.map((r) => r.barcode));
  const waived = new Set(waivers.filter((w) => !w.required).map((w) => w.uniqueid));
  const rows = needing.filter(
    (r) => !waived.has(r.uniqueid) && (!r.barcode || !done.has(r.barcode)),
  );

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_verification_outstanding_${country ?? "all"}_${date}.csv`);
}
