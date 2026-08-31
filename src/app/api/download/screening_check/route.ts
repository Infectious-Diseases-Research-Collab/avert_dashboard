import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";

/**
 * Site/date/RDT-result-only export for reconciling screening numbers against
 * the site's own OPD registry. Deliberately narrow — no names, no
 * vaccination data, not even uniqueid — so it carries none of the blinding
 * risk of the full dataset and can stay a routine, always-available download
 * rather than something that needs admin approval. Every screened record is
 * included (not just enrolled ones): a registry reconciliation needs the
 * count of people seen, not just those who went on to enroll.
 */
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

  type Row = { country: string; mrc: string | null; startdate: string | null; result: number | null };
  type FacRow = { mrc: string; name: string };

  let rows: Row[];
  let facRows: FacRow[];
  try {
    // PostgREST caps every response at this project's ~1,000-row "Max Rows"
    // setting regardless of `.limit()`, so the export has to be paged through
    // with fetchAllRows (see the same fix in src/app/dashboard/page.tsx).
    [rows, facRows] = await Promise.all([
      fetchAllRows<Row>((rangeFrom, rangeTo) => {
        let query = supabase.from("enrollee").select("country,mrc,startdate,result");
        if (country) query = query.eq("country", country);
        if (mrc) query = query.eq("mrc", mrc);
        if (from) query = query.gte("startdate", from);
        if (to) query = query.lte("startdate", to);
        return query.range(rangeFrom, rangeTo);
      }),
      fetchAllRows<FacRow>((rangeFrom, rangeTo) =>
        supabase.from("facilities").select("mrc,name").range(rangeFrom, rangeTo),
      ),
    ]);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const facName = new Map(facRows.map((f) => [f.mrc, f.name]));
  const out = rows.map((r) => ({
    country: r.country,
    facility: r.mrc ? (facName.get(r.mrc) ?? r.mrc) : "",
    date: r.startdate,
    rdt_result: r.result,
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(out), `avert_screening_check_${country ?? "all"}_${date}.csv`);
}
