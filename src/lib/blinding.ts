/**
 * Fields stripped from the routinely downloadable dataset to keep it blinded
 * and free of unnecessary PII. `result` is the study outcome (RDT result);
 * the rest are participant/guardian identifiers. New questionnaire fields
 * are unaffected by default — this is a denylist, not an allowlist — so any
 * future field that carries outcome or personal data needs adding here
 * explicitly. Applies only to the routine download; the full unblinded
 * dataset (admin-generated, time-limited link) is exempt by design.
 */
export const BLINDED_DOWNLOAD_DENYLIST = [
  "result",
  "participantsname",
  "phonenumber_ug",
  "phonenumber_bf",
  "caregiver_name",
] as const;

/** Returns a shallow copy of `raw` with the denylisted keys removed. */
export function stripBlindedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  for (const key of BLINDED_DOWNLOAD_DENYLIST) delete out[key];
  return out;
}
