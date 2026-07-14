import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";

/** Outstanding vaccine-coverage verification list: need_vac_cov=1 with no
 *  matching vaccination_status record. Numbers-only on screen; this CSV is the
 *  actionable follow-up list. */
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

  let query = supabase
    .from("enrollee")
    .select("country,subjid,barcode,mrc,startdate")
    .eq("need_vac_cov", 1)
    .limit(50000);
  if (country) query = query.eq("country", country);
  if (mrc) query = query.eq("mrc", mrc);
  if (from) query = query.gte("startdate", from);
  if (to) query = query.lte("startdate", to);

  const [{ data: needing, error }, { data: covered }] = await Promise.all([
    query,
    supabase.from("vaccination_status").select("barcode"),
  ]);
  if (error) return new Response(error.message, { status: 500 });

  const done = new Set((covered ?? []).map((r) => r.barcode as string));
  const rows = (needing ?? []).filter((r) => !r.barcode || !done.has(r.barcode as string));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_verification_outstanding_${country ?? "all"}_${date}.csv`);
}
