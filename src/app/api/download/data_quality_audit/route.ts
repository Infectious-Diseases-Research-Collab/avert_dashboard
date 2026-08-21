import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { DataQualityAuditEntry } from "@/lib/types";

/**
 * Export the full dismiss/reopen audit history for data-quality issues.
 * Honors ?country=. RLS scopes rows to the caller's country access.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");

  // PostgREST caps every response at this project's ~1,000-row "Max Rows"
  // setting regardless of `.limit()`, so the export has to be paged through
  // with fetchAllRows (see the same fix in src/app/dashboard/page.tsx).
  let auditLog: DataQualityAuditEntry[];
  let facRows: { mrc: string; name: string }[];
  try {
    [auditLog, facRows] = await Promise.all([
      fetchAllRows<DataQualityAuditEntry>((from, to) => {
        let q = supabase.from("data_quality_status_audit").select("*").order("acted_at", { ascending: false });
        if (country) q = q.eq("country", country);
        return q.range(from, to);
      }),
      fetchAllRows<{ mrc: string; name: string }>((from, to) =>
        supabase.from("facilities").select("mrc,name").range(from, to),
      ),
    ]);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const facName = new Map(facRows.map((f) => [f.mrc, f.name]));

  const rows = auditLog.map((r) => ({
    action: r.action,
    actor: r.actor,
    acted_at: r.acted_at,
    check_code: r.check_code,
    country: r.country,
    subjid: r.subjid,
    barcode: r.barcode,
    facility: r.mrc ? (facName.get(r.mrc) ?? r.mrc) : "",
    issue_id: r.issue_id,
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_data_quality_audit_${country ?? "all"}_${date}.csv`);
}
