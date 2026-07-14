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

export function weeklyTrends(screened: Enrollee[]): WeeklyPoint[] {
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
    const wk = e.enrollment_week ?? weekStart(e.startdate);
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
// Age distribution (stacked by sex, binwidth 2)
// ---------------------------------------------------------------------------

export function ageDistribution(screened: Enrollee[]): HistBin[] {
  const data = screened
    .filter(isEnrolled)
    .filter((e) => e.agemonths_calculated != null)
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
  fractionDiscarded: number;
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

export function coverageByWeek(screened: Enrollee[]) {
  const map = new Map<string, { week: string; n: number; d1: number; d3: number }>();
  for (const e of screened.filter(isEnrolled)) {
    const wk = e.enrollment_week ?? weekStart(e.startdate);
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

export function verificationSummary(
  screened: Enrollee[],
  completedBarcodes: Set<string>,
): VerificationSummary {
  const need = screened.filter((e) => e.need_vac_cov === 1 && e.barcode);
  const completed = need.filter((e) => completedBarcodes.has(e.barcode as string)).length;
  return { needed: need.length, completed, outstanding: need.length - completed };
}
