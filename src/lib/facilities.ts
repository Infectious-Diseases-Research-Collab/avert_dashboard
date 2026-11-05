export type FacilityNameRow = { country: string; mrc: string; name: string };

/**
 * Facility name lookup for exports, which can span both countries. mrc codes
 * are only unique within a country (UG and BF both have a 027), so the lookup
 * always takes the two together. Falls back to the raw code for an unknown site.
 */
export function facilityNameLookup(rows: FacilityNameRow[]) {
  const names = new Map(rows.map((f) => [`${f.country}:${f.mrc}`, f.name]));
  return (country: string, mrc: string | null): string =>
    mrc ? (names.get(`${country}:${mrc}`) ?? mrc) : "";
}
