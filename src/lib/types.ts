export type Country = "UG" | "BF";
export type CountryAccess = Country | "BOTH";
export type Locale = "en" | "fr";

export interface Profile {
  email: string;
  country_access: CountryAccess;
  is_admin: boolean;
  default_locale: Locale;
  full_name: string | null;
}

export interface Facility {
  country: Country;
  mrc: string;
  name: string;
  district: string | null;
  region: string | null;
  transmission_zone: string | null;
  /** Null until the coordinate seed has been run (Uganda sites have none yet). */
  latitude: number | null;
  longitude: number | null;
}

export interface Enrollee {
  uniqueid: string;
  country: Country;
  subjid: string | null;
  barcode: string | null;
  mrc: string | null;
  district: string | null;
  subcounty: string | null;
  parish: string | null;
  village: string | null;
  startdate: string | null;
  enrollment_week: string | null;
  dob: string | null;
  agemonths_calculated: number | null;
  age_eligible: number | null;
  mal_test_eligible: number | null;
  consent_eligible: number | null;
  gender: number | null;
  sex: number | null;
  result: number | null;
  vx_card: number | null;
  need_vac_cov: number | null;
  vx_any: number | null;
  vx_doses_received: number | null;
  vx_dose1_date: string | null;
  vx_dose2_date: string | null;
  vx_dose3_date: string | null;
  vx_dose4_date: string | null;
  // Why the participant had no vaccine card, and the free text when that
  // reason is "Other" (96). Both are projected out of the raw jsonb rather
  // than being typed columns, so they arrive as text, not numbers.
  vx_card_no?: string | null;
  vx_card_no_oth?: string | null;
  // Blood-smear fields, null until blood_smear.csv is loaded.
  parasitedensity?: number | null;
  mic_positive?: number | null;
  slidequality?: number | null;
}

export interface VaccinationStatus {
  barcode: string;
  country: Country;
  startdate: string | null;
  vx_card: number | null;
  vx_doses_received: number | null;
}

export interface DataQualityIssue {
  id: number;
  country: Country;
  check_code: string;
  severity: "error" | "warning" | "info";
  subjid: string | null;
  barcode: string | null;
  mrc: string | null;
  field: string | null;
  description: string;
  description_fr: string;
  status: "open" | "resolved" | "dismissed";
  detected_at: string;
  resolved_at: string | null;
  dismissed_at?: string | null;
  dismissed_by?: string | null;
}

export interface DataQualityAuditEntry {
  id: number;
  issue_id: number;
  country: Country;
  check_code: string;
  subjid: string | null;
  barcode: string | null;
  mrc: string | null;
  action: "dismissed" | "reopened";
  actor: string;
  acted_at: string;
}

/** A clinic's decision that an "Other"-reason participant does not in fact
 *  need a vaccine-coverage visit. Only rows with required = false matter;
 *  turning one back on leaves the row behind with required = true. */
export interface VerificationWaiver {
  uniqueid: string;
  required: boolean;
}
