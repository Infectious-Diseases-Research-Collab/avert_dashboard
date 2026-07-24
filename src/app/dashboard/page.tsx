import { redirect } from "next/navigation";
import { getProfile, visibleCountries } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { villageGeoKey } from "@/lib/metrics";
import type { Country, Enrollee, Facility, DataQualityIssue } from "@/lib/types";

const ENROLLEE_COLS =
  "uniqueid,country,subjid,barcode,mrc,district,subcounty,parish,village,startdate,enrollment_week,dob," +
  "agemonths_calculated,age_eligible,mal_test_eligible,consent_eligible,gender,sex," +
  "result,vx_card,need_vac_cov,vx_any,vx_doses_received," +
  "vx_dose1_date,vx_dose2_date,vx_dose3_date,vx_dose4_date";

type VillageRow = {
  countryid: number;
  districtid: number;
  subcountyid: number;
  parishid: number;
  villageid: number;
  village: string;
};

/**
 * Fetch the full village lookup, paginated. The villages table has ~4,800 rows
 * and Supabase caps an unbounded query (~1,000 rows), which would silently drop
 * villages past the first page — Burkina's are all at the end of the list, so a
 * single unbounded fetch loses every BF name. Scope to the countries the user
 * can see (BF users then need just one page) and page through the rest.
 */
async function fetchVillages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  countries: Country[],
): Promise<VillageRow[]> {
  const countryIds = countries.map((c) => (c === "UG" ? 1 : 2));
  const pageSize = 1000;
  const rows: VillageRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("villages")
      .select("countryid,districtid,subcountyid,parishid,villageid,village")
      .in("countryid", countryIds)
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as VillageRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const [facilitiesRes, enrolleeRes, bloodRes, coverageRes, issuesRes, lastRunRes, villageRows] =
    await Promise.all([
      supabase.from("facilities").select("*"),
      supabase.from("enrollee").select(ENROLLEE_COLS).limit(20000),
      supabase.from("blood_smear").select("barcode,parasitedensity,mic_positive,slidequality"),
      supabase.from("vaccination_status").select("barcode"),
      supabase.from("data_quality_issues").select("*").order("detected_at", { ascending: false }),
      supabase
        .from("pipeline_runs")
        .select("finished_at")
        .order("finished_at", { ascending: false })
        .limit(1),
      fetchVillages(supabase, visibleCountries(profile)),
    ]);

  const facilities = (facilitiesRes.data ?? []) as Facility[];
  const enrollees = (enrolleeRes.data ?? []) as unknown as Enrollee[];
  const issues = (issuesRes.data ?? []) as DataQualityIssue[];
  const lastDataPull = (lastRunRes.data?.[0]?.finished_at as string | undefined) ?? null;

  // Village-name lookup keyed by the canonical geo key. Passed to the client as
  // a serializable [key, name][] array; DashboardShell rebuilds the Map.
  const villageLookup: [string, string][] = villageRows.map((v) => [
    villageGeoKey(v.countryid, v.districtid, v.subcountyid, v.parishid, v.villageid),
    v.village,
  ]);

  // Attach microscopy fields from blood_smear (empty until blood_smear.csv is loaded).
  const bloodByBarcode = new Map(
    (bloodRes.data ?? []).map((b) => [b.barcode as string, b]),
  );
  for (const e of enrollees) {
    const b = e.barcode ? bloodByBarcode.get(e.barcode) : undefined;
    if (b) {
      e.mic_positive = b.mic_positive as number | null;
      e.parasitedensity = b.parasitedensity as number | null;
      e.slidequality = b.slidequality as number | null;
    }
  }

  const completedBarcodes = (coverageRes.data ?? [])
    .map((r) => r.barcode as string)
    .filter(Boolean);

  return (
    <DashboardShell
      profile={profile}
      facilities={facilities}
      enrollees={enrollees}
      completedBarcodes={completedBarcodes}
      issues={issues}
      villageLookup={villageLookup}
      lastDataPull={lastDataPull}
    />
  );
}
