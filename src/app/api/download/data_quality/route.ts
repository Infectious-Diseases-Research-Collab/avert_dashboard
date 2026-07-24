import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE } from "@/i18n/request";
import { toCsv, csvResponse } from "@/lib/csv";

/**
 * Export the data-quality issues as CSV, with the human-readable "Error reason"
 * as the first column. Honors ?country= and ?status= (default "open"; "all" for
 * every status). The reason is localized from the AVERT_LOCALE cookie. RLS
 * scopes rows to the caller's country access automatically.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const status = searchParams.get("status") ?? "open";

  const cookieStore = await cookies();
  const fr = cookieStore.get(LOCALE_COOKIE)?.value === "fr";

  let query = supabase
    .from("data_quality_issues")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(100000);
  if (country) query = query.eq("country", country);
  if (status !== "all") query = query.eq("status", status);

  const [issuesRes, facRes] = await Promise.all([
    query,
    supabase.from("facilities").select("mrc,name"),
  ]);
  if (issuesRes.error) return new Response(issuesRes.error.message, { status: 500 });

  const facName = new Map((facRes.data ?? []).map((f) => [f.mrc as string, f.name as string]));

  // "Error reason" is inserted first so toCsv (column order = first-seen key) puts it first.
  const rows = (issuesRes.data ?? []).map((r) => ({
    "Error reason": fr ? r.description_fr : r.description,
    check_code: r.check_code,
    severity: r.severity,
    country: r.country,
    subjid: r.subjid,
    barcode: r.barcode,
    facility: r.mrc ? (facName.get(r.mrc) ?? r.mrc) : "",
    field: r.field,
    status: r.status,
    detected_at: r.detected_at,
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_data_errors_${country ?? "all"}_${date}.csv`);
}
