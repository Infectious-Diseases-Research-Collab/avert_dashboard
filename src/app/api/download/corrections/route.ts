import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { AppliedCorrection } from "@/lib/types";

/**
 * Export the corrections applied centrally in avert_data (audittrail rows with
 * new_sourcefile 'corrections/...', via the applied_corrections view). Honors
 * ?country=. The view is security_invoker, so RLS on audittrail and enrollee
 * scopes rows to the caller's country access.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");

  // Paged for the same PostgREST Max Rows cap as the other exports.
  let corrections: AppliedCorrection[];
  try {
    corrections = await fetchAllRows<AppliedCorrection>((from, to) => {
      let q = supabase.from("applied_corrections").select("*").order("new_lastmod", { ascending: false });
      if (country) q = q.eq("country", country);
      return q.range(from, to);
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const rows = corrections.map((c) => ({
    country: c.country,
    uniqueid: c.uniqueid,
    subjid: c.subjid,
    barcode: c.barcode,
    field: c.fieldname,
    old_value: c.old_value,
    new_value: c.new_value,
    corrected_at: c.new_lastmod,
    reason: c.correction_reason,
    source_document: c.correction_source_document,
    verified_by: c.correction_verified_by,
    source_file: c.new_sourcefile,
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_corrections_${country ?? "all"}_${date}.csv`);
}
