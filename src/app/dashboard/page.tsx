import { redirect } from "next/navigation";
import { getProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { villageGeoKey } from "@/lib/metrics";
import type { Enrollee, Facility, DataQualityIssue } from "@/lib/types";

const ENROLLEE_COLS =
  "uniqueid,country,subjid,barcode,mrc,district,subcounty,parish,village,startdate,enrollment_week,dob," +
  "agemonths_calculated,age_eligible,mal_test_eligible,consent_eligible,gender,sex," +
  "result,vx_card,need_vac_cov,vx_any,vx_doses_received," +
  "vx_dose1_date,vx_dose2_date,vx_dose3_date,vx_dose4_date";

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const [facilitiesRes, enrolleeRes, bloodRes, coverageRes, issuesRes, villagesRes] =
    await Promise.all([
      supabase.from("facilities").select("*"),
      supabase.from("enrollee").select(ENROLLEE_COLS).limit(20000),
      supabase.from("blood_smear").select("barcode,parasitedensity,mic_positive,slidequality"),
      supabase.from("vaccination_status").select("barcode"),
      supabase.from("data_quality_issues").select("*").order("detected_at", { ascending: false }),
      supabase
        .from("villages")
        .select("countryid,districtid,subcountyid,parishid,villageid,village"),
    ]);

  const facilities = (facilitiesRes.data ?? []) as Facility[];
  const enrollees = (enrolleeRes.data ?? []) as unknown as Enrollee[];
  const issues = (issuesRes.data ?? []) as DataQualityIssue[];

  // Village-name lookup keyed by the canonical geo key. Passed to the client as
  // a serializable [key, name][] array; DashboardShell rebuilds the Map.
  const villageLookup: [string, string][] = (villagesRes.data ?? []).map((v) => [
    villageGeoKey(
      v.countryid as number,
      v.districtid as number,
      v.subcountyid as number,
      v.parishid as number,
      v.villageid as number,
    ),
    v.village as string,
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
    />
  );
}
