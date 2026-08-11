"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, SectionTitle, StatCard, EmptyState, fmtPct } from "@/components/ui";
import {
  MultiLine,
  MultiBar,
  MiniBar,
  MiniLine,
  ChartLegend,
  seriesMax,
  PALETTE,
  cycleColor,
} from "@/components/charts";
import { SiteMap } from "@/components/SiteMap";
import {
  DemographicsTable,
  MatchingTable,
  ConcordanceTable,
  VerificationParticipantsTable,
  DataQualityTable,
  DataQualityAuditTable,
} from "@/components/dashboard/tables";
import {
  computeKpis,
  weeklyTrends,
  enrollmentByFacility,
  enrollmentTrendsBySite,
  enrollmentByVillage,
  pickTrendGranularity,
  ageDistribution,
  demographics,
  matchingStats,
  doseDistribution,
  coverageByWeek,
  coverageByAge,
  ageAtVaccination,
  timeSinceLastDose,
  timeBetweenDoses,
  concordance,
  verificationSummary,
  verificationCandidates,
  cumulativeTrends,
  positivityTrends,
  positivityBySite,
  toCumulative,
  withTargetColumns,
  studyStartKey,
  studyEndKey,
  siteProgress,
  DAILY_TARGETS,
  SITE_DAILY_TARGETS,
  type TestType,
  type AgeDistributionBy,
} from "@/lib/metrics";
import type { Enrollee, Facility, DataQualityIssue, DataQualityAuditEntry } from "@/lib/types";

interface SectionProps {
  enrollees: Enrollee[];
  testType: TestType;
  /** Facilities visible under the current country filter (carries coordinates). */
  facilities: Facility[];
  facilityNames: Map<string, string>;
  villageNames: Map<string, string>;
  completedBarcodes: Set<string>;
  /** uniqueids a clinic has decided don't need a vaccine-coverage visit. */
  waivedVerification: Set<string>;
  issues: DataQualityIssue[];
  auditLog: DataQualityAuditEntry[];
  downloadQuery: string;
  /** True when the facility filter has a specific site selected (not "all"). */
  siteSelected: boolean;
}

// ---------------------------------------------------------------------------

export function OverviewSection({
  enrollees,
  testType,
  facilities,
  facilityNames,
  villageNames,
  siteSelected,
}: SectionProps) {
  const t = useTranslations();
  const kpis = useMemo(() => computeKpis(enrollees, testType), [enrollees, testType]);
  const granularity = useMemo(() => pickTrendGranularity(enrollees), [enrollees]);
  const granularityBadge = (
    <span className="muted text-xs rounded-full border border-[var(--border)] px-2 py-0.5 whitespace-nowrap">
      {t(granularity === "day" ? "charts.dailyView" : "charts.weeklyView")}
    </span>
  );

  // Study day 1 = the earliest enrollment day in the visible data; target lines
  // are anchored to it.
  const startKey = useMemo(() => studyStartKey(enrollees), [enrollees]);
  const endKey = useMemo(() => studyEndKey(enrollees), [enrollees]);

  const [trendMode, setTrendMode] = useState<"daily" | "cumulative" | "positivity">("daily");

  const weekly = useMemo(() => weeklyTrends(enrollees, granularity), [enrollees, granularity]);
  const hasMicro = weekly.some((w) => w["Micro+"] + w["Micro-"] > 0);
  const dailyWithTargets = useMemo(
    () => withTargetColumns(weekly, DAILY_TARGETS, granularity, startKey, endKey, false),
    [weekly, granularity, startKey, endKey],
  );
  const cumulative = useMemo(
    () =>
      withTargetColumns(
        cumulativeTrends(enrollees, testType, granularity),
        DAILY_TARGETS,
        granularity,
        startKey,
        endKey,
        true,
      ),
    [enrollees, testType, granularity, startKey, endKey],
  );
  const positivity = useMemo(
    () => positivityTrends(enrollees, testType, granularity),
    [enrollees, testType, granularity],
  );

  // Map: cumulative enrolled per site vs the per-site daily target to date.
  const progress = useMemo(
    () => siteProgress(enrollees, facilities, SITE_DAILY_TARGETS.low),
    [enrollees, facilities],
  );

  const facilityCounts = useMemo(
    () => enrollmentByFacility(enrollees, testType, facilityNames),
    [enrollees, testType, facilityNames],
  );
  const trendsBySite = useMemo(
    () => enrollmentTrendsBySite(enrollees, testType, facilityNames, granularity),
    [enrollees, testType, facilityNames, granularity],
  );
  const siteSeries = useMemo(
    () => trendsBySite.sites.map((s, i) => ({ key: s.name, color: cycleColor(i) })),
    [trendsBySite],
  );
  const [trendView, setTrendView] = useState<"grid" | "line" | "stacked">("grid");
  const [siteMetric, setSiteMetric] = useState<"all" | "cases" | "cumulative" | "positivity">("all");
  // Which series the by-site Cumulative view is cumulating. Enrolled/Cases/
  // Controls all have up to 11 lines on their own, so — unlike the main
  // Cumulative chart, which only ever has 3 lines total — the by-site view
  // shows one metric at a time rather than all three overlaid.
  const [cumulativeMetric, setCumulativeMetric] = useState<"enrolled" | "cases" | "controls">("enrolled");
  // Stacking is only meaningful for the count metrics: cumulative totals would
  // double-count and percentages don't sum. Fall back to the line view.
  const stackable = siteMetric === "all" || siteMetric === "cases";
  const effectiveView = !stackable && trendView === "stacked" ? "line" : trendView;
  const siteNames = useMemo(() => trendsBySite.sites.map((s) => s.name), [trendsBySite]);
  const trendMax = useMemo(
    () => ({
      enrolled: seriesMax(trendsBySite.enrolled, siteNames),
      cases: seriesMax(trendsBySite.cases, siteNames),
      controls: seriesMax(trendsBySite.controls, siteNames),
    }),
    [trendsBySite, siteNames],
  );

  // Grid view: one stacked chart per site. Enrolled is exactly cases +
  // controls, so plotting all three separately drew the same information
  // twice; stack them instead and let the bar height carry the total.
  // Re-shape the three site-keyed row-sets into one {Cases, Controls} series
  // per site, joined on the bucket key (all three share the same buckets).
  const perSiteStacks = useMemo(() => {
    const controlsByWeek = new Map(trendsBySite.controls.map((r) => [String(r.week), r]));
    return trendsBySite.sites.map((site) => {
      const data = trendsBySite.cases.map((r) => ({
        week: String(r.week),
        Cases: (r[site.name] as number) || 0,
        Controls: (controlsByWeek.get(String(r.week))?.[site.name] as number) || 0,
      }));
      return {
        site,
        data,
        caseTotal: data.reduce((s, d) => s + d.Cases, 0),
        total: data.reduce((s, d) => s + d.Cases + d.Controls, 0),
      };
    });
  }, [trendsBySite]);

  // Shared domain across every cell so bar heights stay comparable site to site.
  const stackMax = useMemo(() => {
    let max = 0;
    for (const s of perSiteStacks) {
      for (const d of s.data) max = Math.max(max, d.Cases + d.Controls);
    }
    return max || 1;
  }, [perSiteStacks]);

  // Cases sit on the axis (first in the stack): baseline-anchored segments are
  // much easier to compare than floating ones, and cases are the scarce signal.
  const stackSeries = useMemo(
    () => [
      { key: "Cases", name: t("charts.casesSeries"), color: PALETTE.pos },
      { key: "Controls", name: t("charts.controlsSeries"), color: PALETTE.neg },
    ],
    [t],
  );

  // Per-site cumulative, for whichever of Enrolled/Cases/Controls is
  // selected. Only Enrolled has a meaningful target (4/day, 5.5/day are
  // enrollment targets), so the target lines are attached only for it.
  const cumulativeSourceRows = useMemo(() => {
    if (cumulativeMetric === "cases") return trendsBySite.cases;
    if (cumulativeMetric === "controls") return trendsBySite.controls;
    return trendsBySite.enrolled;
  }, [trendsBySite, cumulativeMetric]);
  const cumulativeBySite = useMemo(
    () =>
      withTargetColumns(
        toCumulative(cumulativeSourceRows, siteNames),
        SITE_DAILY_TARGETS,
        granularity,
        startKey,
        endKey,
        true,
      ),
    [cumulativeSourceRows, siteNames, granularity, startKey, endKey],
  );
  const cumulativeMax = useMemo(
    () =>
      seriesMax(cumulativeBySite, cumulativeMetric === "enrolled" ? [...siteNames, "TargetHigh"] : siteNames),
    [cumulativeBySite, siteNames, cumulativeMetric],
  );
  const positivityBySiteRows = useMemo(() => positivityBySite(trendsBySite), [trendsBySite]);

  /** Rows + series for whichever metric the by-site card is showing. */
  const siteMetricView = useMemo(() => {
    if (siteMetric === "cumulative") {
      return {
        rows: cumulativeBySite as unknown as Record<string, unknown>[],
        series: [
          ...siteSeries,
          ...(cumulativeMetric === "enrolled"
            ? [
                { key: "TargetLow", name: t("charts.targetSiteLow"), color: PALETTE.green, dashed: true },
                { key: "TargetHigh", name: t("charts.targetSiteHigh"), color: PALETTE.orange, dashed: true },
              ]
            : []),
        ],
        domainMax: cumulativeMax,
        percent: false,
      };
    }
    if (siteMetric === "positivity") {
      return {
        rows: positivityBySiteRows as unknown as Record<string, unknown>[],
        series: siteSeries,
        domainMax: 100,
        percent: true,
      };
    }
    return null;
  }, [siteMetric, cumulativeMetric, cumulativeBySite, cumulativeMax, positivityBySiteRows, siteSeries, t]);
  const villages = useMemo(
    () => enrollmentByVillage(enrollees, testType, villageNames),
    [enrollees, testType, villageNames],
  );
  const [ageBy, setAgeBy] = useState<AgeDistributionBy>("sex");
  const ages = useMemo(
    () => ageDistribution(enrollees, ageBy, testType),
    [enrollees, ageBy, testType],
  );
  const demog = useMemo(() => demographics(enrollees, testType), [enrollees, testType]);
  const matching = useMemo(() => matchingStats(enrollees, testType), [enrollees, testType]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t("kpi.screened")} value={kpis.screened} accent={PALETTE.grey} />
        <StatCard label={t("kpi.enrolled")} value={kpis.enrolled} accent={PALETTE.primary} />
        <StatCard label={t("kpi.cases")} value={kpis.cases} accent={PALETTE.pos} />
        <StatCard label={t("kpi.controls")} value={kpis.controls} accent={PALETTE.neg} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <SectionTitle
            title={t(
              trendMode === "cumulative"
                ? "charts.cumulativeTrends"
                : trendMode === "positivity"
                  ? "charts.positivityTrends"
                  : granularity === "day"
                    ? "charts.dailyTrends"
                    : "charts.weeklyTrends",
            )}
            subtitle={t(
              trendMode === "cumulative"
                ? "charts.cumulativeTrendsSub"
                : trendMode === "positivity"
                  ? "charts.positivityTrendsSub"
                  : "charts.dailyTrendsSub",
            )}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                  {(["daily", "cumulative", "positivity"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setTrendMode(m)}
                      className={`px-3 py-1.5 whitespace-nowrap ${
                        trendMode === m
                          ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                          : "hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {t(
                        m === "daily"
                          ? "charts.modeDaily"
                          : m === "cumulative"
                            ? "charts.modeCumulative"
                            : "charts.modePositivity",
                      )}
                    </button>
                  ))}
                </div>
                {granularityBadge}
              </div>
            }
          />

          {trendMode === "daily" && (
            <MultiLine
              data={dailyWithTargets}
              xKey="week"
              dateX
              series={[
                { key: "Screened", color: PALETTE.grey },
                { key: "Enrolled", color: PALETTE.primary },
                { key: "RDT+", color: PALETTE.pos },
                { key: "RDT-", color: PALETTE.neg },
                ...(hasMicro
                  ? [
                      { key: "Micro+", color: PALETTE.purple },
                      { key: "Micro-", color: PALETTE.orange },
                    ]
                  : []),
                { key: "TargetLow", name: t("charts.target3500"), color: PALETTE.green, dashed: true },
                { key: "TargetHigh", name: t("charts.target5000"), color: PALETTE.orange, dashed: true },
              ]}
            />
          )}

          {trendMode === "cumulative" && (
            <MultiLine
              data={cumulative}
              xKey="week"
              dateX
              series={[
                { key: "Enrolled", name: t("charts.enrolledSeries"), color: PALETTE.primary },
                { key: "Cases", name: t("charts.casesSeries"), color: PALETTE.pos },
                { key: "Controls", name: t("charts.controlsSeries"), color: PALETTE.neg },
                { key: "TargetLow", name: t("charts.target3500"), color: PALETTE.green, dashed: true },
                { key: "TargetHigh", name: t("charts.target5000"), color: PALETTE.orange, dashed: true },
              ]}
            />
          )}

          {trendMode === "positivity" && (
            <MultiLine
              data={positivity}
              xKey="week"
              dateX
              percent
              series={[
                { key: "Positivity", name: t("charts.positivitySeries"), color: PALETTE.pos },
              ]}
            />
          )}
        </Card>

        <Card>
          <SectionTitle title={t("map.title")} subtitle={t("map.subtitle")} />
          <SiteMap sites={progress} />
        </Card>
      </div>

      {/* Enrollment by facility — all-sites view only (one bar per site). */}
      {!siteSelected && (
        <Card>
          <SectionTitle
            title={t("charts.enrollmentByFacility")}
            subtitle={t("charts.enrollmentByFacilitySub")}
          />
          <MultiBar
            data={facilityCounts as unknown as Record<string, unknown>[]}
            xKey="name"
            angledX
            series={[
              { key: "enrolled", name: t("charts.enrolledSeries"), color: PALETTE.primary },
              { key: "cases", name: t("charts.casesSeries"), color: PALETTE.pos },
              { key: "controls", name: t("charts.controlsSeries"), color: PALETTE.neg },
            ]}
          />
        </Card>
      )}

      {/* Enrollment trends by site — all-sites view only. */}
      {!siteSelected && siteSeries.length > 0 && (
        <Card>
          <SectionTitle
            title={t("charts.enrollmentTrendsBySite")}
            subtitle={t(
              siteMetric === "cumulative"
                ? "charts.enrollmentTrendsBySiteSubCumulative"
                : siteMetric === "positivity"
                  ? "charts.enrollmentTrendsBySiteSubPositivity"
                  : effectiveView === "grid"
                    ? siteMetric === "cases"
                      ? "charts.enrollmentTrendsBySiteSubGridCases"
                      : "charts.enrollmentTrendsBySiteSubGrid"
                    : effectiveView === "stacked"
                      ? "charts.enrollmentTrendsBySiteSubStacked"
                      : "charts.enrollmentTrendsBySiteSub",
            )}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                  {(["all", "cases", "cumulative", "positivity"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSiteMetric(m)}
                      className={`px-3 py-1.5 whitespace-nowrap ${
                        siteMetric === m
                          ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                          : "hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {t(
                        m === "all"
                          ? "charts.gridAll"
                          : m === "cases"
                            ? "charts.gridCasesOnly"
                            : m === "cumulative"
                              ? "charts.modeCumulative"
                              : "charts.modePositivity",
                      )}
                    </button>
                  ))}
                </div>
                {siteMetric === "cumulative" && (
                  <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                    {(["enrolled", "cases", "controls"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setCumulativeMetric(m)}
                        className={`px-3 py-1.5 whitespace-nowrap ${
                          cumulativeMetric === m
                            ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                            : "hover:bg-[var(--surface-2)]"
                        }`}
                      >
                        {t(
                          m === "enrolled"
                            ? "charts.enrolledSeries"
                            : m === "cases"
                              ? "charts.casesSeries"
                              : "charts.controlsSeries",
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                  {(["grid", "line", "stacked"] as const)
                    // Stacking can't represent cumulative totals or percentages.
                    .filter((v) => v !== "stacked" || stackable)
                    .map((v) => (
                      <button
                        key={v}
                        onClick={() => setTrendView(v)}
                        className={`px-3 py-1.5 ${
                          effectiveView === v
                            ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                            : "hover:bg-[var(--surface-2)]"
                        }`}
                      >
                        {t(
                          v === "grid" ? "charts.viewGrid" : v === "line" ? "charts.viewLine" : "charts.viewStacked",
                        )}
                      </button>
                    ))}
                </div>
                {granularityBadge}
              </div>
            }
          />

          {/* Cumulative / positivity: one full-width chart, all sites overlaid. */}
          {siteMetricView && effectiveView === "line" && (
            <>
              <MultiLine
                data={siteMetricView.rows}
                xKey="week"
                dateX
                percent={siteMetricView.percent}
                legend={false}
                series={siteMetricView.series}
              />
              <ChartLegend series={siteMetricView.series} />
            </>
          )}

          {!siteMetricView && effectiveView === "line" && (
            <>
              <div className="grid lg:grid-cols-3 gap-4">
                {(
                  [
                    [t("charts.enrolledSeries"), trendsBySite.enrolled],
                    [t("charts.casesSeries"), trendsBySite.cases],
                    [t("charts.controlsSeries"), trendsBySite.controls],
                  ] as const
                ).map(([label, data]) => (
                  <div key={label}>
                    <div className="muted text-xs font-medium mb-1">{label}</div>
                    <MultiLine data={data} xKey="week" dateX height={220} legend={false} series={siteSeries} />
                  </div>
                ))}
              </div>
              <ChartLegend series={siteSeries} />
            </>
          )}

          {effectiveView === "stacked" && (
            <>
              <div className="grid lg:grid-cols-3 gap-4">
                {(
                  [
                    [t("charts.enrolledSeries"), trendsBySite.enrolled],
                    [t("charts.casesSeries"), trendsBySite.cases],
                    [t("charts.controlsSeries"), trendsBySite.controls],
                  ] as const
                ).map(([label, data]) => (
                  <div key={label}>
                    <div className="muted text-xs font-medium mb-1">{label}</div>
                    <MultiBar
                      data={data as unknown as Record<string, unknown>[]}
                      xKey="week"
                      dateX
                      stacked
                      height={220}
                      legend={false}
                      series={siteSeries}
                    />
                  </div>
                ))}
              </div>
              <ChartLegend series={siteSeries} />
            </>
          )}

          {effectiveView === "grid" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                {perSiteStacks.map(({ site, data, caseTotal, total }) => {
                  // Cumulative / positivity cells read a single site's column
                  // out of the shared row-set and draw it as a line.
                  const lineRows: Record<string, number | string | null>[] | null = siteMetricView
                    ? siteMetricView.rows.map((r) => {
                        const cell: Record<string, number | string | null> = {
                          week: r.week as string,
                          [site.name]: (r[site.name] as number | null) ?? null,
                        };
                        if (siteMetric === "cumulative" && cumulativeMetric === "enrolled") {
                          cell.TargetLow = r.TargetLow as number;
                          cell.TargetHigh = r.TargetHigh as number;
                        }
                        return cell;
                      })
                    : null;
                  const cellSeries = siteMetricView
                    ? [
                        { key: site.name, color: cycleColor(0) },
                        ...(siteMetric === "cumulative" && cumulativeMetric === "enrolled"
                          ? [
                              { key: "TargetLow", color: PALETTE.green, dashed: true },
                              { key: "TargetHigh", color: PALETTE.orange, dashed: true },
                            ]
                          : []),
                      ]
                    : [];
                  const last = lineRows?.length ? lineRows[lineRows.length - 1][site.name] : null;

                  return (
                    <div key={site.mrc} className="rounded-lg border border-[var(--border)] p-2">
                      <div className="flex items-center justify-between gap-2 text-xs mb-1">
                        <span className="font-medium truncate" title={site.name}>
                          {site.name}
                        </span>
                        {siteMetric === "all" ? (
                          <span
                            className="tabular-nums shrink-0"
                            title={t("charts.siteTotals", { cases: caseTotal, total })}
                          >
                            <span style={{ color: PALETTE.pos }}>{caseTotal}</span>
                            <span className="muted">/{total}</span>
                          </span>
                        ) : siteMetric === "cases" ? (
                          <span className="muted tabular-nums shrink-0">{caseTotal}</span>
                        ) : (
                          <span className="muted tabular-nums shrink-0">
                            {last == null ? "—" : siteMetric === "positivity" ? `${last}%` : last}
                          </span>
                        )}
                      </div>
                      {lineRows ? (
                        <MiniLine
                          data={lineRows}
                          xKey="week"
                          series={cellSeries}
                          percent={siteMetricView!.percent}
                          domainMax={siteMetricView!.domainMax}
                        />
                      ) : (
                        <MiniBar
                          data={data}
                          xKey="week"
                          stacked={siteMetric === "all"}
                          series={siteMetric === "all" ? stackSeries : [stackSeries[0]]}
                          domainMax={siteMetric === "all" ? stackMax : trendMax.cases}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {siteMetric === "all" && <ChartLegend series={stackSeries} />}
              {siteMetric === "cumulative" && cumulativeMetric === "enrolled" && (
                <ChartLegend
                  series={[
                    { key: "TargetLow", name: t("charts.targetSiteLow"), color: PALETTE.green },
                    { key: "TargetHigh", name: t("charts.targetSiteHigh"), color: PALETTE.orange },
                  ]}
                />
              )}
            </>
          )}
        </Card>
      )}

      {/* Enrollment by village — site-specific view only. */}
      {siteSelected && villages.length > 0 && (
        <Card>
          <SectionTitle
            title={t("charts.enrollmentByVillage")}
            subtitle={t("charts.enrollmentByVillageSub")}
          />
          <MultiBar
            data={villages as unknown as Record<string, unknown>[]}
            xKey="name"
            angledX
            series={[
              { key: "enrolled", name: t("charts.enrolledSeries"), color: PALETTE.primary },
              { key: "cases", name: t("charts.casesSeries"), color: PALETTE.pos },
              { key: "controls", name: t("charts.controlsSeries"), color: PALETTE.neg },
            ]}
          />
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <SectionTitle
            title={t("charts.ageDistribution")}
            subtitle={t(ageBy === "sex" ? "charts.ageDistributionSub" : "charts.ageDistributionSubCaseControl")}
            action={
              <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                {(["sex", "caseControl"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setAgeBy(v)}
                    className={`px-3 py-1.5 whitespace-nowrap ${
                      ageBy === v
                        ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                        : "hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    {t(v === "sex" ? "charts.bySex" : "charts.byCaseControl")}
                  </button>
                ))}
              </div>
            }
          />
          <MultiBar
            data={ages as unknown as Record<string, unknown>[]}
            xKey="label"
            stacked
            series={
              ageBy === "sex"
                ? [
                    { key: "Male", name: t("charts.male"), color: PALETTE.neg },
                    { key: "Female", name: t("charts.female"), color: PALETTE.grey },
                  ]
                : [
                    { key: "Cases", name: t("charts.casesSeries"), color: PALETTE.pos },
                    { key: "Controls", name: t("charts.controlsSeries"), color: PALETTE.neg },
                  ]
            }
          />
        </Card>
        <Card>
          <SectionTitle title={t("tables.demographics")} />
          <DemographicsTable data={demog} />
        </Card>
      </div>

      <Card>
        <SectionTitle title={t("tables.matching")} />
        <MatchingTable data={matching} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function VaccineCoverageSection({ enrollees }: SectionProps) {
  const t = useTranslations();
  const kpis = useMemo(() => computeKpis(enrollees, "rdt"), [enrollees]);
  const granularity = useMemo(() => pickTrendGranularity(enrollees), [enrollees]);
  const granularityBadge = (
    <span className="muted text-xs rounded-full border border-[var(--border)] px-2 py-0.5 whitespace-nowrap">
      {t(granularity === "day" ? "charts.dailyView" : "charts.weeklyView")}
    </span>
  );
  const doses = useMemo(() => doseDistribution(enrollees), [enrollees]);
  const coverage = useMemo(() => coverageByWeek(enrollees, granularity), [enrollees, granularity]);
  const covByAge = useMemo(() => coverageByAge(enrollees), [enrollees]);
  const ageVax = useMemo(() => ageAtVaccination(enrollees), [enrollees]);
  const sinceLast = useMemo(() => timeSinceLastDose(enrollees), [enrollees]);
  const between = useMemo(() => timeBetweenDoses(enrollees), [enrollees]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t("kpi.withCard")}
          value={fmtPct(kpis.cardPct, 0)}
          sub={`${kpis.cardCount}/${kpis.enrolled}`}
          accent={PALETTE.primary}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <SectionTitle title={t("charts.doses")} />
          <MultiBar
            data={doses as unknown as Record<string, unknown>[]}
            xKey="doses"
            series={[{ key: "count", name: t("charts.count"), color: PALETTE.primary }]}
          />
        </Card>
        <Card>
          <SectionTitle
            title={t(granularity === "day" ? "charts.coverageByDay" : "charts.coverageByWeek")}
            action={granularityBadge}
          />
          <MultiLine
            data={coverage}
            xKey="week"
            dateX
            percent
            series={[
              { key: "≥1 Dose", color: PALETTE.primary },
              { key: "≥3 Doses", color: PALETTE.pos },
            ]}
          />
        </Card>
      </div>

      <Card>
        <SectionTitle title={t("charts.coverageByAge")} subtitle={t("charts.coverageByAgeSub")} />
        <MultiBar
          data={covByAge as unknown as Record<string, unknown>[]}
          xKey="label"
          percent
          series={[{ key: "pct", name: t("charts.atLeastOneDose"), color: PALETTE.primary }]}
        />
      </Card>

      <Card>
        <SectionTitle title={t("charts.ageAtVaccination")} subtitle={t("charts.ageAtVaccinationSub")} />
        <MultiBar
          data={ageVax as unknown as Record<string, unknown>[]}
          xKey="x"
          refLines={[6, 7, 8, 18].map((x) => ({ x, label: `${x}` }))}
          series={[
            { key: "Dose 1", color: PALETTE.primary },
            { key: "Dose 2", color: PALETTE.pos },
            { key: "Dose 3", color: PALETTE.orange },
            { key: "Dose 4", color: PALETTE.purple },
          ]}
        />
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <SectionTitle title={t("charts.timeSinceLastDose")} />
          <MultiBar
            data={sinceLast as unknown as Record<string, unknown>[]}
            xKey="x"
            series={[{ key: "Weeks", name: t("charts.weeks"), color: PALETTE.primary }]}
          />
        </Card>
        <Card>
          <SectionTitle title={t("charts.timeBetweenDoses")} />
          <MultiBar
            data={between as unknown as Record<string, unknown>[]}
            xKey="x"
            refLines={[{ x: 4, label: "4" }]}
            series={[
              { key: "Dose 1→2", color: PALETTE.primary },
              { key: "Dose 2→3", color: PALETTE.pos },
              { key: "Dose 3→4", color: PALETTE.orange },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MicroscopySection({ enrollees }: SectionProps) {
  const t = useTranslations();
  const c = useMemo(() => concordance(enrollees), [enrollees]);

  if (!c.hasData) {
    return (
      <Card>
        <SectionTitle title={t("microscopy.title")} />
        <EmptyState title={t("microscopy.noData")} hint={t("microscopy.noDataHint")} />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <SectionTitle title={t("tables.crosstab")} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 border-b border-[var(--border)]" />
                  <th className="px-3 py-2 border-b border-[var(--border)] text-right muted font-medium">
                    Micro+
                  </th>
                  <th className="px-3 py-2 border-b border-[var(--border)] text-right muted font-medium">
                    Micro−
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-2 border-b border-[var(--border)]">RDT+</td>
                  <td className="px-3 py-2 border-b border-[var(--border)] text-right tabular-nums">{c.tp}</td>
                  <td className="px-3 py-2 border-b border-[var(--border)] text-right tabular-nums">{c.fp}</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 border-b border-[var(--border)]">RDT−</td>
                  <td className="px-3 py-2 border-b border-[var(--border)] text-right tabular-nums">{c.fn}</td>
                  <td className="px-3 py-2 border-b border-[var(--border)] text-right tabular-nums">{c.tn}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <SectionTitle title={t("tables.concordanceMetrics")} />
          <ConcordanceTable c={c} />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function VerificationSection({
  enrollees,
  facilityNames,
  completedBarcodes,
  waivedVerification,
  downloadQuery,
}: SectionProps) {
  const t = useTranslations();
  // Waivers toggled this session (uniqueid -> required). Held here rather than
  // in the table so the summary cards and the rows move together; the server
  // data only refreshes on a reload.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const effWaived = useMemo(() => {
    const s = new Set(waivedVerification);
    for (const [id, required] of overrides) {
      if (required) s.delete(id);
      else s.add(id);
    }
    return s;
  }, [waivedVerification, overrides]);

  const summary = useMemo(
    () => verificationSummary(enrollees, completedBarcodes, effWaived),
    [enrollees, completedBarcodes, effWaived],
  );
  const participants = useMemo(() => verificationCandidates(enrollees), [enrollees]);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle title={t("verification.title")} subtitle={t("verification.intro")} />
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={t("kpi.needed")} value={summary.needed} accent={PALETTE.orange} />
          <StatCard label={t("kpi.completed")} value={summary.completed} accent={PALETTE.primary} />
          <StatCard label={t("kpi.outstanding")} value={summary.outstanding} accent={PALETTE.pos} />
        </div>
        <a
          href={`/api/download/verification?${downloadQuery}`}
          className="inline-flex mt-4 items-center gap-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] px-4 py-2 text-sm font-medium"
        >
          {t("verification.downloadOutstanding")}
        </a>
      </Card>

      <Card>
        <SectionTitle title={t("verification.participants")} subtitle={t("verification.participantsIntro")} />
        <VerificationParticipantsTable
          rows={participants}
          facilityNames={facilityNames}
          completedBarcodes={completedBarcodes}
          waived={effWaived}
          onToggled={(uniqueid, required) =>
            setOverrides((m) => new Map(m).set(uniqueid, required))
          }
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DataQualitySection({ issues, auditLog, facilityNames, downloadQuery }: SectionProps) {
  const t = useTranslations();
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title={t("dataQuality.title")}
          subtitle={t("dataQuality.intro")}
          action={
            <a
              href={`/api/download/data_quality?${downloadQuery}`}
              className="text-sm rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)] whitespace-nowrap"
            >
              {t("dataQuality.downloadErrors")}
            </a>
          }
        />
        <DataQualityTable issues={issues} facilityNames={facilityNames} />
      </Card>

      <Card>
        <SectionTitle
          title={t("dataQuality.auditTitle")}
          subtitle={t("dataQuality.auditIntro")}
          action={
            <a
              href={`/api/download/data_quality_audit?${downloadQuery}`}
              className="text-sm rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)] whitespace-nowrap"
            >
              {t("dataQuality.downloadAudit")}
            </a>
          }
        />
        <DataQualityAuditTable entries={auditLog} facilityNames={facilityNames} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DownloadSection({ downloadQuery }: SectionProps) {
  const t = useTranslations();
  const items = [
    { key: "enrollee", label: t("download.enrollee"), href: `/api/download/enrollee?${downloadQuery}` },
    {
      key: "vaccination_status",
      label: t("download.vaccinationStatus"),
      href: `/api/download/vaccination_status?${downloadQuery}`,
    },
    {
      key: "barcodes",
      label: t("download.barcodes"),
      href: `/api/download/barcodes?${downloadQuery}`,
    },
  ];
  return (
    <Card>
      <SectionTitle title={t("download.title")} subtitle={t("download.intro")} />
      <div className="grid sm:grid-cols-2 gap-4">
        {items.map((it) => (
          <div key={it.key} className="border border-[var(--border)] rounded-lg p-4 flex items-center justify-between">
            <span className="font-medium">{it.label}</span>
            <a
              href={it.href}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] px-4 py-2 text-sm font-medium"
            >
              {t("download.button")}
            </a>
          </div>
        ))}
      </div>
    </Card>
  );
}
