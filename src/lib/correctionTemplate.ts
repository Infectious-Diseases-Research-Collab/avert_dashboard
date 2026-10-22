import { toCsv } from "@/lib/csv";
import { BLINDED_DOWNLOAD_DENYLIST } from "@/lib/blinding";
import type { DataQualityIssue } from "@/lib/types";

/**
 * Columns of avert_data's corrections/field/*.csv, in its order. The template
 * has to load there unchanged, so this list must match it exactly.
 */
export const CORRECTION_TEMPLATE_COLUMNS = [
  "uniqueid",
  "country",
  "subjid",
  "barcode",
  "field",
  "old_value",
  "new_value",
  "reason",
  "source_document",
  "verified_by",
  "verified_at",
  "corrected_by",
] as const;

/**
 * Checks a field correction does not fix: duplicate subject IDs go through
 * corrections/subjid_corrections.csv, a near-duplicate name is blinded PII,
 * and the reference-date age is derived (the fix is to dob, not to it).
 */
const EXCLUDED_CHECKS = new Set(["duplicate_subjid", "possible_duplicate_name", "age_ineligible_reference_date"]);

/** Derived by the pipeline, so never corrected directly. */
const DERIVED_FIELDS = new Set(["agemonths_calculated"]);

const BLINDED = new Set<string>(BLINDED_DOWNLOAD_DENYLIST);

/** Barcode is entered twice, and a barcode fix has to correct both copies. */
const BARCODE_PAIR: Record<string, string> = { barcode: "barcode2", barcode2: "barcode" };

export type TemplateEnrollee = {
  uniqueid: string;
  subjid: string | null;
  barcode: string | null;
  raw: Record<string, unknown>;
};

/**
 * Build the pre-filled corrections CSV: one row per field of every issue that
 * a field correction could fix, with the record's current value as old_value.
 * Everything from new_value on is left blank for the person making the
 * correction. `issues` should already be the open issues the caller can see.
 */
export function buildCorrectionTemplate(
  issues: DataQualityIssue[],
  enrollees: Map<string, TemplateEnrollee>,
): string {
  const currentValue = (e: TemplateEnrollee, field: string): string => {
    const v = field === "barcode" ? (e.barcode ?? e.raw?.barcode) : e.raw?.[field];
    if (v == null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };

  const seen = new Set<string>();
  const rows: Record<(typeof CORRECTION_TEMPLATE_COLUMNS)[number], string>[] = [];
  const add = (issue: DataQualityIssue, e: TemplateEnrollee, field: string) => {
    const key = `${e.uniqueid}|${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      uniqueid: e.uniqueid,
      country: issue.country,
      subjid: e.subjid ?? "",
      barcode: e.barcode ?? "",
      field,
      old_value: currentValue(e, field),
      new_value: "",
      reason: "",
      source_document: "",
      verified_by: "",
      verified_at: "",
      corrected_by: "",
    });
  };

  for (const issue of issues) {
    if (EXCLUDED_CHECKS.has(issue.check_code) || !issue.uniqueid || !issue.field) continue;
    const e = enrollees.get(issue.uniqueid);
    if (!e) continue;
    // Some checks name several fields ("agemonths_calculated/gender/village").
    for (const field of issue.field.split("/").map((f) => f.trim())) {
      if (!field || DERIVED_FIELDS.has(field) || BLINDED.has(field)) continue;
      add(issue, e, field);
      if (BARCODE_PAIR[field]) add(issue, e, BARCODE_PAIR[field]);
    }
  }

  rows.sort(
    (a, b) =>
      a.country.localeCompare(b.country) ||
      a.subjid.localeCompare(b.subjid) ||
      a.uniqueid.localeCompare(b.uniqueid) ||
      a.field.localeCompare(b.field),
  );

  // toCsv returns "" for no rows; the template still needs its header then.
  return rows.length ? toCsv(rows) : CORRECTION_TEMPLATE_COLUMNS.join(",");
}
