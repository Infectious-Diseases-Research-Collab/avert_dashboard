import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";

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

  type DeployedRow = { barcode: string; country: string };
  type UsedRow = { barcode: string | null; country: string; subjid: string | null; mrc: string | null };

  // PostgREST caps every response at this project's ~1,000-row "Max Rows"
  // setting regardless of `.limit()`, so both exports have to be paged
  // through with fetchAllRows (see the same fix in src/app/dashboard/page.tsx).
  let deployedRows: DeployedRow[];
  let usedRows: UsedRow[];
  let facRows: { mrc: string; name: string }[];
  try {
    [deployedRows, usedRows, facRows] = await Promise.all([
      fetchAllRows<DeployedRow>((from, to) => {
        let q = supabase.from("deployed_barcodes").select("barcode,country");
        if (country) q = q.eq("country", country);
        return q.range(from, to);
      }),
      fetchAllRows<UsedRow>((from, to) => {
        let q = supabase.from("enrollee").select("barcode,country,subjid,mrc").not("barcode", "is", null);
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

  type Row = {
    barcode: string;
    country: string;
    deployed: string;
    used: string;
    subjid: string;
    facility: string;
  };
  const byBarcode = new Map<string, Row>();

  for (const d of deployedRows) {
    byBarcode.set(d.barcode, {
      barcode: d.barcode,
      country: d.country,
      deployed: "Y",
      used: "N",
      subjid: "",
      facility: "",
    });
  }
  for (const u of usedRows) {
    const barcode = u.barcode;
    if (!barcode) continue;
    const facility = u.mrc ? (facName.get(u.mrc) ?? u.mrc) : "";
    const existing = byBarcode.get(barcode);
    if (existing) {
      existing.used = "Y";
      existing.subjid = u.subjid ?? "";
      existing.facility = facility;
    } else {
      byBarcode.set(barcode, {
        barcode,
        country: u.country,
        deployed: "N",
        used: "Y",
        subjid: u.subjid ?? "",
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
