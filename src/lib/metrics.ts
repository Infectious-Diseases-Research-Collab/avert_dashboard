import type { Enrollee } from "@/lib/types";

export type TestType = "rdt" | "microscopy";

// ---------------------------------------------------------------------------
// Small date / binning helpers
// ---------------------------------------------------------------------------

const MS_DAY = 86_400_000;

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / MS_DAY;
}

/** Sunday-start week floor (matches lubridate floor_date(x,"week")). */
export function weekStart(s: string | null): string | null {
  const d = parseDate(s);
  if (!d) return null;
  const shift = d.getUTCDay(); // 0 = Sunday
  const w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - shift));
  return w.toISOString().slice(0, 10);
}

/** UTC-normalized calendar day (no floor beyond the day itself). */
export function dayStart(s: string | null): string | null {
  const d = parseDate(s);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export type TrendGranularity = "day" | "week";

/**
 * Daily buckets read better than 1-2 sparse weekly points early in a study;
 * once there's enough history, weekly buckets are smoother. Base the choice
 * on the actual span of the data (not the from/to filter window) so it also
 * adapts correctly when a user manually narrows the date filter.
 */
export function pickTrendGranularity(screened: Enrollee[]): TrendGranularity {
  const dates = screened.map((e) => parseDate(e.startdate)).filter((d): d is Date => d !== null);
  if (dates.length === 0) return "week";
  const min = Math.min(...dates.map((d) => d.getTime()));
  const max = Math.max(...dates.map((d) => d.getTime()));
  const spanDays = (max - min) / MS_DAY;
  return spanDays <= 28 ? "day" : "week";
}

/** Every bucket key (day or week start) spanned by the given dates, in order. */
function bucketKeysInRange(dates: Date[], granularity: TrendGranularity): string[] {
  if (dates.length === 0) return [];
  const min = Math.min(...dates.map((d) => d.getTime()));
  const max = Math.max(...dates.map((d) => d.getTime()));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = min; t <= max; t += MS_DAY) {
    const s = new Date(t).toISOString().slice(0, 10);
    const key = granularity === "day" ? dayStart(s) : weekStart(s);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export interface HistBin {
  x: number; // left edge
  label: string;
  [series: string]: number | string;
}

/** Bin values into fixed-width buckets, one count column per series. */
export function histogram(
  data: { value: number; series: string }[],
  binWidth: number,
  seriesOrder: string[],
): HistBin[] {
  if (data.length === 0) return [];
  const min = Math.floor(Math.min(...data.map((d) => d.value)) / binWidth) * binWidth;
  const max = Math.max(...data.map((d) => d.value));
  const bins = new Map<number, HistBin>();
  for (let x = min; x <= max; x += binWidth) {
    const bin: HistBin = { x, label: `${x}` };
    seriesOrder.forEach((s) => (bin[s] = 0));
    bins.set(x, bin);
  }
  for (const { value, series } of data) {
    const x = Math.floor(value / binWidth) * binWidth;
    const bin = bins.get(x);
    if (bin) bin[series] = (bin[series] as number) + 1;
  }
  return [...bins.values()].sort((a, b) => a.x - b.x);
}

// ---------------------------------------------------------------------------
// Core record predicates (ported from R/data_loader.R + get_filtered_data)
// ---------------------------------------------------------------------------

export function isEnrolled(e: Enrollee): boolean {
  return e.age_eligible === 1 && e.mal_test_eligible === 1 && e.consent_eligible === 1;
}

/** Case-definition result: RDT `result` or microscopy `mic_positive`. */
export function testResult(e: Enrollee, testType: TestType): number | null {
  const v = testType === "microscopy" ? e.mic_positive : e.result;
  return v === 1 || v === 0 ? v : null;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface Kpis {
  screened: number;
  enrolled: number;
  cases: number;
  controls: number;
  cardPct: number;
  cardCount: number;
  microscopyPct: number;
  microscopyCount: number;
}

export function computeKpis(screened: Enrollee[], testType: TestType): Kpis {
  const enrolled = screened.filter(isEnrolled);
  const cases = enrolled.filter((e) => testResult(e, testType) === 1).length;
  const controls = enrolled.filter((e) => testResult(e, testType) === 0).length;
  const cardCount = enrolled.filter((e) => e.vx_card === 1).length;
  const micCount = enrolled.filter((e) => e.mic_positive === 1 || e.mic_positive === 0).length;
  const n = enrolled.length || 1;
  return {
    screened: screened.length,
    enrolled: enrolled.length,
    cases,
    controls,
    cardCount,
    cardPct: (cardCount / n) * 100,
    microscopyCount: micCount,
    microscopyPct: (micCount / n) * 100,
  };
}

// ---------------------------------------------------------------------------
// Weekly enrollment trends
// ---------------------------------------------------------------------------

export interface WeeklyPoint {
  week: string;
  Screened: number;
  Enrolled: number;
  "RDT+": number;
  "RDT-": number;
  "Micro+": number;
  "Micro-": number;
}

export function weeklyTrends(screened: Enrollee[], granularity: TrendGranularity = "week"): WeeklyPoint[] {
  const map = new Map<string, WeeklyPoint>();
  const get = (wk: string) => {
    let p = map.get(wk);
    if (!p) {
      p = { week: wk, Screened: 0, Enrolled: 0, "RDT+": 0, "RDT-": 0, "Micro+": 0, "Micro-": 0 };
      map.set(wk, p);
    }
    return p;
  };
  for (const e of screened) {
    const wk = granularity === "day" ? dayStart(e.startdate) : (e.enrollment_week ?? weekStart(e.startdate));
    if (!wk) continue;
    get(wk).Screened += 1;
    if (!isEnrolled(e)) continue;
    const p = get(wk);
    p.Enrolled += 1;
    if (e.result === 1) p["RDT+"] += 1;
    if (e.result === 0) p["RDT-"] += 1;
    if (e.mic_positive === 1) p["Micro+"] += 1;
    if (e.mic_positive === 0) p["Micro-"] += 1;
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
}

// ---------------------------------------------------------------------------
// Enrollment by facility
// ---------------------------------------------------------------------------

export interface FacilityCount {
  mrc: string;
  name: string;
  enrolled: number;
  cases: number;
  controls: number;
}

export function enrollmentByFacility(
  screened: Enrollee[],
  testType: TestType,
  names: Map<string, string>,
): FacilityCount[] {
  const map = new Map<string, FacilityCount>();
  for (const e of screened.filter(isEnrolled)) {
    const mrc = e.mrc ?? "?";
    let f = map.get(mrc);
    if (!f) {
      f = { mrc, name: names.get(mrc) ?? `Site ${mrc}`, enrolled: 0, cases: 0, controls: 0 };
      map.set(mrc, f);
    }
    f.enrolled += 1;
    const r = testResult(e, testType);
    if (r === 1) f.cases += 1;
    if (r === 0) f.controls += 1;
  }
  return [...map.values()].sort((a, b) => b.enrolled - a.enrolled);
}

// ---------------------------------------------------------------------------
// Enrollment trends by site (one line per facility, over enrollment weeks)
// ---------------------------------------------------------------------------

export interface TrendsBySite {
  sites: { mrc: string; name: string }[];
  enrolled: Record<string, number | string>[];
  cases: Record<string, number | string>[];
  controls: Record<string, number | string>[];
}

/**
 * Weekly enrolled / cases / controls counts, one series (column) per facility.
 * Returns three week-indexed row-sets keyed by facility name, plus the ordered
 * site list for building chart series. Used in the all-sites Overview view.
 */
export function enrollmentTrendsBySite(
  screened: Enrollee[],
  testType: TestType,
  names: Map<string, string>,
  granularity: TrendGranularity = "week",
): TrendsBySite {
  const enrolled = screened.filter(isEnrolled);

  // Sites present, ordered by total enrollment (busiest first).
  const totals = new Map<string, number>();
  for (const e of enrolled) totals.set(e.mrc ?? "?", (totals.get(e.mrc ?? "?") ?? 0) + 1);
  const sites = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([mrc]) => ({ mrc, name: names.get(mrc) ?? `Site ${mrc}` }));

  // Every metric shares the same bucket range so the three panels line up on
  // the same x-axis, even for buckets where one metric (e.g. cases) is zero.
  const buckets = bucketKeysInRange(
    enrolled.map((e) => parseDate(e.startdate)).filter((d): d is Date => d !== null),
    granularity,
  );

  // week -> { [siteName]: count } for each metric.
  const mk = () => {
    const m = new Map<string, Record<string, number | string>>();
    for (const wk of buckets) {
      const row: Record<string, number | string> = { week: wk };
      sites.forEach((s) => (row[s.name] = 0));
      m.set(wk, row);
    }
    return m;
  };
  const enrolledW = mk();
  const casesW = mk();
  const controlsW = mk();

  const bump = (
    m: Map<string, Record<string, number | string>>,
    week: string,
    name: string,
  ) => {
    const row = m.get(week);
    if (!row) return;
    row[name] = (row[name] as number) + 1;
  };

  for (const e of enrolled) {
    const wk = granularity === "day" ? dayStart(e.startdate) : (e.enrollment_week ?? weekStart(e.startdate));
    if (!wk) continue;
    const name = names.get(e.mrc ?? "?") ?? `Site ${e.mrc}`;
    bump(enrolledW, wk, name);
    const r = testResult(e, testType);
    if (r === 1) bump(casesW, wk, name);
    if (r === 0) bump(controlsW, wk, name);
  }

  const sortByWeek = (m: Map<string, Record<string, number | string>>) =>
    [...m.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));

  return {
    sites,
    enrolled: sortByWeek(enrolledW),
    cases: sortByWeek(casesW),
    controls: sortByWeek(controlsW),
  };
}

// ---------------------------------------------------------------------------
// Cumulative trends, enrollment targets, and test positivity
// ---------------------------------------------------------------------------

/** Study-wide daily enrollment targets (Burkina Faso). */
export const DAILY_TARGETS = { low: 46, high: 65 } as const;
/** Per-site daily enrollment targets. 12 sites x 4 = 48 ~ 46; x 5.5 = 66 ~ 65. */
export const SITE_DAILY_TARGETS = { low: 4, high: 5.5 } as const;

/** Earliest enrollment day present in the data — day 1 of the study. */
export function studyStartKey(screened: Enrollee[]): string | null {
  let min: string | null = null;
  for (const e of screened) {
    const k = dayStart(e.startdate);
    if (k && (min === null || k < min)) min = k;
  }
  return min;
}

/** Latest enrollment day present in the data. */
export function studyEndKey(screened: Enrollee[]): string | null {
  let max: string | null = null;
  for (const e of screened) {
    const k = dayStart(e.startdate);
    if (k && (max === null || k > max)) max = k;
  }
  return max;
}

/**
 * Days of study elapsed at the END of a bucket, 1-based (first day = 1).
 * Weekly buckets are credited through their last day, clamped to the last day
 * that actually has data so the final partial week doesn't inflate its target.
 */
export function studyDayIndex(
  bucketKey: string,
  startKey: string,
  granularity: TrendGranularity,
  maxDataKey: string,
): number {
  const start = parseDate(startKey);
  const bucket = parseDate(bucketKey);
  const maxData = parseDate(maxDataKey);
  if (!start || !bucket || !maxData) return 0;
  let end = bucket;
  if (granularity === "week") {
    const weekEnd = new Date(bucket.getTime() + 6 * MS_DAY);
    end = weekEnd.getTime() > maxData.getTime() ? maxData : weekEnd;
  }
  return Math.max(1, Math.round(daysBetween(end, start)) + 1);
}

/** Running sum of the named columns, leaving other fields untouched. */
export function toCumulative<T extends object>(rows: T[], keys: string[]): T[] {
  const running = new Map<string, number>();
  return rows.map((row) => {
    const src = row as Record<string, unknown>;
    const out = { ...src };
    for (const k of keys) {
      const v = src[k];
      const next = (running.get(k) ?? 0) + (typeof v === "number" ? v : 0);
      running.set(k, next);
      out[k] = next;
    }
    return out as T;
  });
}

export interface CumulativePoint {
  week: string;
  Enrolled: number;
  Cases: number;
  Controls: number;
  [target: string]: number | string;
}

/**
 * Cumulative enrolled / cases / controls over time. Buckets with no enrollment
 * are still emitted (carrying the previous running total) so the line doesn't
 * jump across gaps and the target comparison stays honest.
 */
export function cumulativeTrends(
  screened: Enrollee[],
  testType: TestType,
  granularity: TrendGranularity = "week",
): CumulativePoint[] {
  const enrolled = screened.filter(isEnrolled);
  const dates = enrolled.map((e) => parseDate(e.startdate)).filter((d): d is Date => d !== null);
  const buckets = bucketKeysInRange(dates, granularity);

  const per = new Map<string, { Enrolled: number; Cases: number; Controls: number }>();
  for (const b of buckets) per.set(b, { Enrolled: 0, Cases: 0, Controls: 0 });
  for (const e of enrolled) {
    const key = granularity === "day" ? dayStart(e.startdate) : weekStart(e.startdate);
    const row = key ? per.get(key) : undefined;
    if (!row) continue;
    row.Enrolled += 1;
    const r = testResult(e, testType);
    if (r === 1) row.Cases += 1;
    if (r === 0) row.Controls += 1;
  }

  const flat = buckets.map((b) => ({ week: b, ...per.get(b)! }));
  return toCumulative(flat, ["Enrolled", "Cases", "Controls"]) as CumulativePoint[];
}

export interface PositivityPoint {
  week: string;
  Positivity: number | null;
}

/**
 * Test positivity (cases / enrolled, as a percentage) per bucket. Buckets with
 * no enrollees yield null rather than 0 so the line breaks instead of dropping
 * to the axis, which would read as "positivity was zero that day".
 */
/**
 * Per-bucket (not cumulative): cases / enrolled for that day or week alone,
 * as asked for. Daily buckets are noisy at typical daily counts, but once the
 * dashboard's granularity switches to weekly (see pickTrendGranularity) a
 * bucket's N is large enough for the ratio to read as an actual trend — and
 * unlike a cumulative running average, a per-bucket ratio still shows a real
 * recent shift instead of diluting it with all prior history. Null (not 0)
 * for a bucket with no test results, so the line breaks rather than diving to
 * the axis.
 */
export function positivityTrends(
  screened: Enrollee[],
  testType: TestType,
  granularity: TrendGranularity = "week",
): PositivityPoint[] {
  const enrolled = screened.filter(isEnrolled);
  const dates = enrolled.map((e) => parseDate(e.startdate)).filter((d): d is Date => d !== null);
  const buckets = bucketKeysInRange(dates, granularity);

  const per = new Map<string, { n: number; cases: number }>();
  for (const b of buckets) per.set(b, { n: 0, cases: 0 });
  for (const e of enrolled) {
    const key = granularity === "day" ? dayStart(e.startdate) : weekStart(e.startdate);
    const row = key ? per.get(key) : undefined;
    if (!row) continue;
    const r = testResult(e, testType);
    if (r === null) continue; // untested records can't inform positivity
    row.n += 1;
    if (r === 1) row.cases += 1;
  }

  return buckets.map((b) => {
    const row = per.get(b)!;
    return {
      week: b,
      Positivity: row.n ? Math.round((row.cases / row.n) * 1000) / 10 : null,
    };
  });
}

/**
 * Per-site, per-bucket positivity, derived from an existing
 * enrollmentTrendsBySite result. Same per-bucket rationale as
 * positivityTrends — noisy at low daily counts, but usable once the
 * dashboard is on weekly buckets.
 */
export function positivityBySite(trends: TrendsBySite): Record<string, number | string | null>[] {
  const casesByWeek = new Map(trends.cases.map((r) => [String(r.week), r]));
  return trends.enrolled.map((row) => {
    const out: Record<string, number | string | null> = { week: String(row.week) };
    for (const s of trends.sites) {
      const n = (row[s.name] as number) || 0;
      const c = (casesByWeek.get(String(row.week))?.[s.name] as number) || 0;
      out[s.name] = n ? Math.round((c / n) * 1000) / 10 : null;
    }
    return out;
  });
}

/**
 * Add TargetLow/TargetHigh columns to a bucketed row-set. Flat targets scale a
 * daily rate by the bucket width (a weekly bucket's target is 7x the daily
 * rate); cumulative targets are rate x days elapsed, so they slope upward.
 */
export function withTargetColumns<T extends object>(
  rows: T[],
  targets: { low: number; high: number },
  granularity: TrendGranularity,
  startKey: string | null,
  maxDataKey: string | null,
  cumulative: boolean,
): (T & { TargetLow: number; TargetHigh: number })[] {
  const perBucket = granularity === "week" ? 7 : 1;
  return rows.map((row) => {
    if (!cumulative) {
      return { ...row, TargetLow: targets.low * perBucket, TargetHigh: targets.high * perBucket };
    }
    const week = String((row as Record<string, unknown>).week ?? "");
    const day =
      startKey && maxDataKey ? studyDayIndex(week, startKey, granularity, maxDataKey) : 0;
    return {
      ...row,
      TargetLow: Math.round(targets.low * day * 10) / 10,
      TargetHigh: Math.round(targets.high * day * 10) / 10,
    };
  });
}

export interface SiteProgress {
  mrc: string;
  name: string;
  latitude: number;
  longitude: number;
  cases: number;
  target: number;
  /** cases / target; 1 means exactly on pace. */
  ratio: number;
}

/**
 * Cumulative CASES per site measured against a per-site daily case target,
 * for the map — per the study team: "colored by how far or close the current
 * cumulative enrollment (of cases) is to the target ... assuming we want to
 * enroll 4 cases per day per site." Only facilities with coordinates are
 * returned.
 */
export function siteProgress(
  screened: Enrollee[],
  facilities: { mrc: string; name: string; latitude?: number | null; longitude?: number | null }[],
  testType: TestType,
  ratePerDay: number,
): SiteProgress[] {
  const start = studyStartKey(screened);
  const end = studyEndKey(screened);
  const startD = parseDate(start);
  const endD = parseDate(end);
  const days = startD && endD ? Math.max(1, Math.round(daysBetween(endD, startD)) + 1) : 0;

  const counts = new Map<string, number>();
  for (const e of screened.filter(isEnrolled)) {
    if (testResult(e, testType) !== 1) continue;
    const mrc = e.mrc ?? "?";
    counts.set(mrc, (counts.get(mrc) ?? 0) + 1);
  }

  const target = ratePerDay * days;
  return facilities
    .filter((f) => typeof f.latitude === "number" && typeof f.longitude === "number")
    .map((f) => {
      const cases = counts.get(f.mrc) ?? 0;
      return {
        mrc: f.mrc,
        name: f.name,
        latitude: f.latitude as number,
        longitude: f.longitude as number,
        cases,
        target,
        ratio: target > 0 ? cases / target : 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Enrollment by village (site-specific view; needs the villages name lookup)
// ---------------------------------------------------------------------------

// The villages lookup keys on countryid (1=UG, 2=BF) + district/subcounty/
// parish/village ids (bigint), while enrollee stores country as 'UG'/'BF' and
// the geo codes as zero-padded text ('02'). Normalize both sides to one key.
function normCountry(c: string | number | null | undefined): string {
  const s = String(c ?? "");
  if (s === "UG") return "1";
  if (s === "BF") return "2";
  return s;
}
function normCode(x: string | number | null | undefined): string {
  const n = parseInt(String(x ?? ""), 10);
  return Number.isNaN(n) ? "" : String(n);
}

/** Canonical geo key joining an enrollee (or a villages row) to a village name. */
export function villageGeoKey(
  country: string | number | null | undefined,
  district: string | number | null | undefined,
  subcounty: string | number | null | undefined,
  parish: string | number | null | undefined,
  village: string | number | null | undefined,
): string {
  return [normCountry(country), normCode(district), normCode(subcounty), normCode(parish), normCode(village)].join("|");
}

export interface VillageCount {
  key: string;
  name: string;
  enrolled: number;
  cases: number;
  controls: number;
}

export function enrollmentByVillage(
  screened: Enrollee[],
  testType: TestType,
  villageNames: Map<string, string>,
): VillageCount[] {
  const map = new Map<string, VillageCount>();
  for (const e of screened.filter(isEnrolled)) {
    const key = villageGeoKey(e.country, e.district, e.subcounty, e.parish, e.village);
    let v = map.get(key);
    if (!v) {
      v = {
        key,
        name: villageNames.get(key) ?? `Village ${e.village ?? "?"}`,
        enrolled: 0,
        cases: 0,
        controls: 0,
      };
      map.set(key, v);
    }
    v.enrolled += 1;
    const r = testResult(e, testType);
    if (r === 1) v.cases += 1;
    if (r === 0) v.controls += 1;
  }
  return [...map.values()].sort((a, b) => b.enrolled - a.enrolled);
}

// ---------------------------------------------------------------------------
// Age distribution (stacked by sex, binwidth 2)
// ---------------------------------------------------------------------------

/** How to split the age histogram: by sex, or by case/control status. */
export type AgeDistributionBy = "sex" | "caseControl";

export function ageDistribution(
  screened: Enrollee[],
  by: AgeDistributionBy = "sex",
  testType: TestType = "rdt",
): HistBin[] {
  const enrolled = screened
    .filter(isEnrolled)
    .filter((e) => e.agemonths_calculated != null);

  // Records that can't be classified (no sex recorded, or no test result under
  // the active case definition) are dropped rather than bucketed as "Unknown".
  if (by === "caseControl") {
    const data = enrolled
      .map((e) => {
        const r = testResult(e, testType);
        return {
          value: e.agemonths_calculated as number,
          series: r === 1 ? "Cases" : r === 0 ? "Controls" : "Unknown",
        };
      })
      .filter((d) => d.series !== "Unknown");
    return histogram(data, 2, ["Cases", "Controls"]);
  }

  const data = enrolled
    .map((e) => ({
      value: e.agemonths_calculated as number,
      series: e.sex === 1 ? "Male" : e.sex === 0 ? "Female" : "Unknown",
    }))
    .filter((d) => d.series !== "Unknown");
  return histogram(data, 2, ["Male", "Female"]);
}

// ---------------------------------------------------------------------------
// Demographics summary table
// ---------------------------------------------------------------------------

export interface DemogColumn {
  n: number;
  male: number;
  female: number;
  meanAge: number | null;
  medianAge: number | null;
  minAge: number | null;
  maxAge: number | null;
}

function summarize(rows: Enrollee[]): DemogColumn {
  const ages = rows.map((e) => e.agemonths_calculated).filter((a): a is number => a != null);
  const sorted = [...ages].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;
  return {
    n: rows.length,
    male: rows.filter((e) => e.sex === 1).length,
    female: rows.filter((e) => e.sex === 0).length,
    meanAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
    medianAge: median,
    minAge: sorted.length ? sorted[0] : null,
    maxAge: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

export function demographics(screened: Enrollee[], testType: TestType) {
  const enrolled = screened.filter(isEnrolled);
  return {
    overall: summarize(enrolled),
    cases: summarize(enrolled.filter((e) => testResult(e, testType) === 1)),
    controls: summarize(enrolled.filter((e) => testResult(e, testType) === 0)),
  };
}

// ---------------------------------------------------------------------------
// Case-control matching (greedy 1:1, 3 scenarios)
// ---------------------------------------------------------------------------

export interface MatchScenario {
  scenario: string;
  matchedPairs: number;
  unmatchedCases: number;
  unusedControls: number;
  /** Share of ALL enrolled participants left unpaired by this scenario. */
  fractionDiscarded: number;
  /** Share of CASES specifically left unmatched — the loss that actually costs
   * analytic power, since every discarded case is an unrecoverable event. */
  fractionCasesDiscarded: number;
}

function greedyMatch(
  cases: Enrollee[],
  controls: Enrollee[],
  ok: (c: Enrollee, k: Enrollee) => boolean,
): number {
  const used = new Set<number>();
  let matched = 0;
  for (const c of cases) {
    for (let i = 0; i < controls.length; i++) {
      if (used.has(i)) continue;
      if (ok(c, controls[i])) {
        used.add(i);
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

export function matchingStats(screened: Enrollee[], testType: TestType): MatchScenario[] {
  const enrolled = screened.filter(isEnrolled);
  const total = enrolled.length;
  const cases = enrolled.filter((e) => testResult(e, testType) === 1);
  const controls = enrolled.filter((e) => testResult(e, testType) === 0);

  const sameSite = (c: Enrollee, k: Enrollee) => c.mrc === k.mrc && c.village === k.village;
  const dateOk = (c: Enrollee, k: Enrollee) => {
    const a = parseDate(c.startdate);
    const b = parseDate(k.startdate);
    return a != null && b != null && Math.abs(daysBetween(a, b)) <= 14;
  };
  const ageOk = (c: Enrollee, k: Enrollee) =>
    c.agemonths_calculated != null &&
    k.agemonths_calculated != null &&
    Math.abs(c.agemonths_calculated - k.agemonths_calculated) <= 2;

  const scenarios: [string, (c: Enrollee, k: Enrollee) => boolean][] = [
    ["Site + village + date (±14d) + age (±2mo)", (c, k) => sameSite(c, k) && dateOk(c, k) && ageOk(c, k)],
    ["Site + village + date (±14d)", (c, k) => sameSite(c, k) && dateOk(c, k)],
    ["Site + village", sameSite],
  ];

  return scenarios.map(([scenario, ok]) => {
    const matched = greedyMatch(cases, controls, ok);
    return {
      scenario,
      matchedPairs: matched,
      unmatchedCases: cases.length - matched,
      unusedControls: controls.length - matched,
      fractionDiscarded: total ? (total - 2 * matched) / total : 0,
      fractionCasesDiscarded: cases.length ? (cases.length - matched) / cases.length : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Vaccine coverage charts
// ---------------------------------------------------------------------------

export function doseDistribution(screened: Enrollee[]) {
  const enrolled = screened.filter(isEnrolled);
  const counts = new Map<number, number>();
  for (const e of enrolled) {
    const d = e.vx_doses_received ?? 0;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const total = enrolled.length || 1;
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([doses, count]) => ({
      doses: String(doses),
      count,
      pct: (count / total) * 100,
    }));
}

export function coverageByWeek(screened: Enrollee[], granularity: TrendGranularity = "week") {
  const map = new Map<string, { week: string; n: number; d1: number; d3: number }>();
  for (const e of screened.filter(isEnrolled)) {
    const wk = granularity === "day" ? dayStart(e.startdate) : (e.enrollment_week ?? weekStart(e.startdate));
    if (!wk) continue;
    let p = map.get(wk);
    if (!p) {
      p = { week: wk, n: 0, d1: 0, d3: 0 };
      map.set(wk, p);
    }
    p.n += 1;
    const doses = e.vx_doses_received ?? 0;
    if (doses >= 1) p.d1 += 1;
    if (doses >= 3) p.d3 += 1;
  }
  return [...map.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((p) => ({
      week: p.week,
      "≥1 Dose": p.n ? (p.d1 / p.n) * 100 : 0,
      "≥3 Doses": p.n ? (p.d3 / p.n) * 100 : 0,
    }));
}

export interface CoverageByAgeBin {
  x: number;        // bin left edge, in months
  label: string;    // e.g. "6–7"
  n: number;        // enrolled participants in this age bin
  covered: number;  // of those, how many received >= 1 dose
  pct: number;      // covered / n, as a percentage
}

/**
 * Vaccine coverage (share with at least one dose) by age at enrollment,
 * bucketed into fixed-width age bins. Bins with no participants are omitted
 * rather than plotted as 0% — an empty bin has no coverage to report, and
 * drawing it as zero would read as "nobody here was vaccinated".
 */
export function coverageByAge(screened: Enrollee[], binWidth = 2): CoverageByAgeBin[] {
  const enrolled = screened
    .filter(isEnrolled)
    .filter((e) => e.agemonths_calculated != null);
  if (enrolled.length === 0) return [];

  const bins = new Map<number, { n: number; covered: number }>();
  for (const e of enrolled) {
    const x = Math.floor((e.agemonths_calculated as number) / binWidth) * binWidth;
    let b = bins.get(x);
    if (!b) {
      b = { n: 0, covered: 0 };
      bins.set(x, b);
    }
    b.n += 1;
    if ((e.vx_doses_received ?? 0) >= 1) b.covered += 1;
  }

  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, b]) => ({
      x,
      label: binWidth === 1 ? `${x}` : `${x}–${x + binWidth - 1}`,
      n: b.n,
      covered: b.covered,
      // Rounded so the chart tooltip reads "71.4", not "71.42857142857143".
      pct: Math.round((b.covered / b.n) * 1000) / 10,
    }));
}

export function ageAtVaccination(screened: Enrollee[]): HistBin[] {
  const doseFields: (keyof Enrollee)[] = [
    "vx_dose1_date",
    "vx_dose2_date",
    "vx_dose3_date",
    "vx_dose4_date",
  ];
  const data: { value: number; series: string }[] = [];
  for (const e of screened.filter((x) => isEnrolled(x) && x.vx_any === 1)) {
    const dob = parseDate(e.dob);
    if (!dob) continue;
    doseFields.forEach((f, i) => {
      const d = parseDate(e[f] as string | null);
      if (d) data.push({ value: daysBetween(d, dob) / 30.44, series: `Dose ${i + 1}` });
    });
  }
  return histogram(data, 1, ["Dose 1", "Dose 2", "Dose 3", "Dose 4"]);
}

export function timeSinceLastDose(screened: Enrollee[]): HistBin[] {
  const data: { value: number; series: string }[] = [];
  for (const e of screened.filter((x) => isEnrolled(x) && x.vx_any === 1)) {
    const start = parseDate(e.startdate);
    if (!start) continue;
    const doses = [e.vx_dose1_date, e.vx_dose2_date, e.vx_dose3_date, e.vx_dose4_date]
      .map(parseDate)
      .filter((d): d is Date => d != null);
    if (!doses.length) continue;
    const last = new Date(Math.max(...doses.map((d) => d.getTime())));
    const weeks = daysBetween(start, last) / 7;
    if (weeks >= 0) data.push({ value: weeks, series: "Weeks" });
  }
  return histogram(data, 2, ["Weeks"]);
}

export function timeBetweenDoses(screened: Enrollee[]): HistBin[] {
  const data: { value: number; series: string }[] = [];
  for (const e of screened.filter((x) => isEnrolled(x) && (x.vx_doses_received ?? 0) >= 2)) {
    const dates = [e.vx_dose1_date, e.vx_dose2_date, e.vx_dose3_date, e.vx_dose4_date].map(parseDate);
    const pairs: [number, number, string][] = [
      [0, 1, "Dose 1→2"],
      [1, 2, "Dose 2→3"],
      [2, 3, "Dose 3→4"],
    ];
    for (const [a, b, label] of pairs) {
      const da = dates[a];
      const db = dates[b];
      if (da && db) {
        const weeks = daysBetween(db, da) / 7;
        if (weeks > 0) data.push({ value: weeks, series: label });
      }
    }
  }
  return histogram(data, 1, ["Dose 1→2", "Dose 2→3", "Dose 3→4"]);
}

// ---------------------------------------------------------------------------
// Microscopy: crosstab + concordance (empty-safe)
// ---------------------------------------------------------------------------

export interface Concordance {
  hasData: boolean;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  sensitivity: number | null;
  specificity: number | null;
  ppv: number | null;
  npv: number | null;
  agreement: number | null;
}

export function concordance(screened: Enrollee[]): Concordance {
  const both = screened.filter(
    (e) => isEnrolled(e) && (e.mic_positive === 0 || e.mic_positive === 1) && (e.result === 0 || e.result === 1),
  );
  const tp = both.filter((e) => e.result === 1 && e.mic_positive === 1).length;
  const tn = both.filter((e) => e.result === 0 && e.mic_positive === 0).length;
  const fp = both.filter((e) => e.result === 1 && e.mic_positive === 0).length;
  const fn = both.filter((e) => e.result === 0 && e.mic_positive === 1).length;
  const pct = (num: number, den: number) => (den ? (num / den) * 100 : null);
  return {
    hasData: both.length > 0,
    tp,
    tn,
    fp,
    fn,
    sensitivity: pct(tp, tp + fn),
    specificity: pct(tn, tn + fp),
    ppv: pct(tp, tp + fp),
    npv: pct(tn, tn + fn),
    agreement: pct(tp + tn, both.length),
  };
}

// ---------------------------------------------------------------------------
// Vaccine-verification (coverage-visit) tracking
// ---------------------------------------------------------------------------

export interface VerificationSummary {
  needed: number;
  completed: number;
  outstanding: number;
}

/** Everyone the app flagged for a vaccine-coverage visit, waived or not. The
 *  table shows all of them (a waived one under "Not required", so the decision
 *  stays reviewable); only the summary cards drop the waived ones. */
export function verificationCandidates(screened: Enrollee[]): Enrollee[] {
  return screened.filter((e) => e.need_vac_cov === 1 && e.barcode);
}

export type VerificationState = "outstanding" | "done" | "not_required";

/** The single definition of a participant's verification state, so the table,
 *  the summary cards and the CSV export can't drift apart. A waiver wins over
 *  a completed visit, which wins over an outstanding one. */
export function verificationState(
  e: Enrollee,
  completedBarcodes: Set<string>,
  waived: Set<string>,
): VerificationState {
  if (waived.has(e.uniqueid)) return "not_required";
  if (e.barcode && completedBarcodes.has(e.barcode)) return "done";
  return "outstanding";
}

export function verificationSummary(
  screened: Enrollee[],
  completedBarcodes: Set<string>,
  waived: Set<string> = new Set(),
): VerificationSummary {
  const need = verificationCandidates(screened).filter((e) => !waived.has(e.uniqueid));
  const completed = need.filter((e) => completedBarcodes.has(e.barcode as string)).length;
  return { needed: need.length, completed, outstanding: need.length - completed };
}
