import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";

/**
 * Deployed-vs-used barcode comparison CSV: one row per barcode, flagging
 * whether it's on the deployed list (deployed=Y/N) and whether it's assigned to
 * an enrollee (used=Y/N), plus the enrollee's subject id/facility when used.
 * Honors ?country=. RLS scopes both tables to the caller's country access.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");

  let deployedQ = supabase.from("deployed_barcodes").select("barcode,country").limit(100000);
  let usedQ = supabase
    .from("enrollee")
    .select("barcode,country,subjid,mrc")
    .not("barcode", "is", null)
    .limit(100000);
  if (country) {
    deployedQ = deployedQ.eq("country", country);
    usedQ = usedQ.eq("country", country);
  }

  const [deployedRes, usedRes, facRes] = await Promise.all([
    deployedQ,
    usedQ,
    supabase.from("facilities").select("mrc,name"),
  ]);
  if (deployedRes.error) return new Response(deployedRes.error.message, { status: 500 });
  if (usedRes.error) return new Response(usedRes.error.message, { status: 500 });

  const facName = new Map((facRes.data ?? []).map((f) => [f.mrc as string, f.name as string]));

  type Row = {
    barcode: string;
    country: string;
    deployed: string;
    used: string;
    subjid: string;
    facility: string;
  };
  const byBarcode = new Map<string, Row>();

  for (const d of deployedRes.data ?? []) {
    byBarcode.set(d.barcode as string, {
      barcode: d.barcode as string,
      country: d.country as string,
      deployed: "Y",
      used: "N",
      subjid: "",
      facility: "",
    });
  }
  for (const u of usedRes.data ?? []) {
    const barcode = u.barcode as string;
    if (!barcode) continue;
    const facility = u.mrc ? (facName.get(u.mrc as string) ?? (u.mrc as string)) : "";
    const existing = byBarcode.get(barcode);
    if (existing) {
      existing.used = "Y";
      existing.subjid = (u.subjid as string) ?? "";
      existing.facility = facility;
    } else {
      byBarcode.set(barcode, {
        barcode,
        country: u.country as string,
        deployed: "N",
        used: "Y",
        subjid: (u.subjid as string) ?? "",
        facility,
      });
    }
  }

  const rows = [...byBarcode.values()].sort((a, b) => a.barcode.localeCompare(b.barcode));
  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(
    toCsv(rows as unknown as Record<string, unknown>[]),
    `avert_barcodes_${country ?? "all"}_${date}.csv`,
  );
}
