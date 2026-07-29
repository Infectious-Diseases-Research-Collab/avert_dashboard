import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";

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

  let query = supabase
    .from("data_quality_status_audit")
    .select("*")
    .order("acted_at", { ascending: false })
    .limit(100000);
  if (country) query = query.eq("country", country);

  const [auditRes, facRes] = await Promise.all([
    query,
    supabase.from("facilities").select("mrc,name"),
  ]);
  if (auditRes.error) return new Response(auditRes.error.message, { status: 500 });

  const facName = new Map((facRes.data ?? []).map((f) => [f.mrc as string, f.name as string]));

  const rows = (auditRes.data ?? []).map((r) => ({
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
