import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  let query = supabase.from("enrollee").select("country,uniqueid,raw").limit(50000);
  const country = searchParams.get("country");
  const mrc = searchParams.get("mrc");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (country) query = query.eq("country", country);
  if (mrc) query = query.eq("mrc", mrc);
  if (from) query = query.gte("startdate", from);
  if (to) query = query.lte("startdate", to);

  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  // Flatten the full raw survey row, prefixed with country/uniqueid.
  const rows = (data ?? []).map((r) => ({
    country: r.country,
    uniqueid: r.uniqueid,
    ...(r.raw as Record<string, unknown>),
  }));

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(toCsv(rows), `avert_enrollee_${country ?? "all"}_${date}.csv`);
}
