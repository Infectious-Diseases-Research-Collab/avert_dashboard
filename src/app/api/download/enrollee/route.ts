import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { stripBlindedFields } from "@/lib/blinding";

type EnrolleeExportRow = { country: string; uniqueid: string; raw: Record<string, unknown> };

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

  // PostgREST caps every response at this project's ~1,000-row "Max Rows"
  // setting regardless of `.limit()`, so the export has to be paged through
  // with fetchAllRows or it silently truncates once the table passes 1,000
  // rows (see the same fix in src/app/dashboard/page.tsx).
  let data: EnrolleeExportRow[];
  try {
    data = await fetchAllRows<EnrolleeExportRow>((rangeFrom, rangeTo) => {
      let query = supabase.from("enrollee").select("country,uniqueid,raw");
      if (country) query = query.eq("country", country);
      if (mrc) query = query.eq("mrc", mrc);
      if (from) query = query.gte("startdate", from);
      if (to) query = query.lte("startdate", to);
      return query.range(rangeFrom, rangeTo);
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  // Flatten the raw survey row, prefixed with country/uniqueid, with the
  // outcome and PII fields stripped to keep this routine export blinded.
  const rows = data.map((r) => ({
    country: r.country,
    uniqueid: r.uniqueid,
    ...stripBlindedFields(r.raw as Record<string, unknown>),
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_enrollee_${country ?? "all"}_${date}.csv`);
}
