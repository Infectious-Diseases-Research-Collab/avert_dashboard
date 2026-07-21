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
  status: "open" | "resolved";
  detected_at: string;
  resolved_at: string | null;
}
