import { redirect } from "next/navigation";
import { getProfile, visibleCountries } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { villageGeoKey } from "@/lib/metrics";
import type {
  Country,
  Enrollee,
  Facility,
  DataQualityIssue,
  DataQualityAuditEntry,
  VerificationWaiver,
} from "@/lib/types";

const ENROLLEE_COLS =
  "uniqueid,country,subjid,barcode,mrc,district,subcounty,parish,village,startdate,enrollment_week,dob," +
  "agemonths_calculated,age_eligible,mal_test_eligible,consent_eligible,gender,sex," +
  "result,vx_card,need_vac_cov,vx_any,vx_doses_received," +
  "vx_dose1_date,vx_dose2_date,vx_dose3_date,vx_dose4_date," +
  // Not typed columns -- projected out of the raw jsonb, so they arrive as
  // text. Drives the reason shown in the verification list.
  "vx_card_no:raw->>vx_card_no,vx_card_no_oth:raw->>vx_card_no_oth";

type VillageRow = {
  countryid: number;
  districtid: number;
  subcountyid: number;
  parishid: number;
  villageid: number;
  village: string;
};

type BloodSmearRow = {
  barcode: string;
  parasitedensity: number | null;
  mic_positive: number | null;
  slidequality: number | null;
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
  return fetchAllRows<VillageRow>((from, to) =>
    supabase
      .from("villages")
      .select("countryid,districtid,subcountyid,parishid,villageid,village")
      .in("countryid", countryIds)
      .range(from, to),
  );
}

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const [
    facilitiesRes,
    enrollees,
    bloodRows,
    coverageBarcodes,
    issues,
    auditLog,
    waivers,
    lastRunRes,
    villageRows,
  ] =
    await Promise.all([
      supabase.from("facilities").select("*"),
      // PostgREST caps every response at this project's ~1,000-row "Max Rows"
      // setting regardless of `.limit()` — enrollee already exceeds that, so
      // it (and every other table that can grow past 1,000 rows) has to be
      // paged through with fetchAllRows, same as fetchVillages above.
      // The select string's raw->>field aliases defeat postgrest-js's column
      // type inference (same reason the original single-shot query needed an
      // `unknown` cast), so the builder is cast through `unknown` here too.
      fetchAllRows<Enrollee>(
        (from, to) =>
          supabase.from("enrollee").select(ENROLLEE_COLS).range(from, to) as unknown as PromiseLike<
            PageResult<Enrollee>
          >,
      ),
      fetchAllRows<BloodSmearRow>((from, to) =>
        supabase
          .from("blood_smear")
          .select("barcode,parasitedensity,mic_positive,slidequality")
          .range(from, to),
      ),
      fetchAllRows<{ barcode: string }>((from, to) =>
        supabase.from("vaccination_status").select("barcode").range(from, to),
      ),
      fetchAllRows<DataQualityIssue>((from, to) =>
        supabase
          .from("data_quality_issues")
          .select("*")
          .order("detected_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows<DataQualityAuditEntry>((from, to) =>
        supabase
          .from("data_quality_status_audit")
          .select("*")
          .order("acted_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows<VerificationWaiver>((from, to) =>
        supabase.from("verification_waivers").select("uniqueid,required").range(from, to),
      ),
      supabase
        .from("pipeline_runs")
        .select("finished_at")
        .order("finished_at", { ascending: false })
        .limit(1),
      fetchVillages(supabase, visibleCountries(profile)),
      // Usage logging (see supabase/schema.sql `access_log`) — best-effort, not
      // read anywhere in the app, so its result is intentionally discarded.
      supabase.rpc("log_access_event", { p_event: "page_view" }),
    ]);

  const facilities = (facilitiesRes.data ?? []) as Facility[];
  const lastDataPull = (lastRunRes.data?.[0]?.finished_at as string | undefined) ?? null;

  // Village-name lookup keyed by the canonical geo key. Passed to the client as
  // a serializable [key, name][] array; DashboardShell rebuilds the Map.
  const villageLookup: [string, string][] = villageRows.map((v) => [
    villageGeoKey(v.countryid, v.districtid, v.subcountyid, v.parishid, v.villageid),
    v.village,
  ]);

  // Attach microscopy fields from blood_smear (empty until blood_smear.csv is loaded).
  const bloodByBarcode = new Map(bloodRows.map((b) => [b.barcode, b]));
  for (const e of enrollees) {
    const b = e.barcode ? bloodByBarcode.get(e.barcode) : undefined;
    if (b) {
      e.mic_positive = b.mic_positive;
      e.parasitedensity = b.parasitedensity;
      e.slidequality = b.slidequality;
    }
  }

  const completedBarcodes = coverageBarcodes.map((r) => r.barcode).filter(Boolean);

  // Only required = false matters: turning a visit back on leaves the row
  // behind with required = true, which is the same as never having waived it.
  const waivedVerification = waivers.filter((w) => !w.required).map((w) => w.uniqueid);

  return (
    <DashboardShell
      profile={profile}
      facilities={facilities}
      enrollees={enrollees}
      completedBarcodes={completedBarcodes}
      waivedVerification={waivedVerification}
      issues={issues}
      auditLog={auditLog}
      villageLookup={villageLookup}
      lastDataPull={lastDataPull}
    />
  );
}
