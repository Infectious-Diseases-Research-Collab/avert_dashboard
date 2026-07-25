"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, SectionTitle, StatCard, EmptyState, fmtPct } from "@/components/ui";
import { MultiLine, MultiBar, MiniBar, ChartLegend, seriesMax, PALETTE, cycleColor } from "@/components/charts";
import {
  DemographicsTable,
  MatchingTable,
  ConcordanceTable,
  VerificationByFacilityTable,
  DataQualityTable,
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
  ageAtVaccination,
  timeSinceLastDose,
  timeBetweenDoses,
  concordance,
  verificationSummary,
  type TestType,
} from "@/lib/metrics";
import type { Enrollee, DataQualityIssue } from "@/lib/types";

interface SectionProps {
  enrollees: Enrollee[];
  testType: TestType;
  facilityNames: Map<string, string>;
  villageNames: Map<string, string>;
  completedBarcodes: Set<string>;
  issues: DataQualityIssue[];
  downloadQuery: string;
  /** True when the facility filter has a specific site selected (not "all"). */
  siteSelected: boolean;
}

// ---------------------------------------------------------------------------

export function OverviewSection({
  enrollees,
  testType,
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
  const weekly = useMemo(() => weeklyTrends(enrollees, granularity), [enrollees, granularity]);
  const hasMicro = weekly.some((w) => w["Micro+"] + w["Micro-"] > 0);
  const facilities = useMemo(
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
  const [trendView, setTrendView] = useState<"grid" | "line">("grid");
  const siteNames = useMemo(() => trendsBySite.sites.map((s) => s.name), [trendsBySite]);
  const trendMax = useMemo(
    () => ({
      enrolled: seriesMax(trendsBySite.enrolled, siteNames),
      cases: seriesMax(trendsBySite.cases, siteNames),
      controls: seriesMax(trendsBySite.controls, siteNames),
    }),
    [trendsBySite, siteNames],
  );
  const villages = useMemo(
    () => enrollmentByVillage(enrollees, testType, villageNames),
    [enrollees, testType, villageNames],
  );
  const ages = useMemo(() => ageDistribution(enrollees), [enrollees]);
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

      <Card>
        <SectionTitle
          title={t(granularity === "day" ? "charts.dailyTrends" : "charts.weeklyTrends")}
          action={granularityBadge}
        />
        <MultiLine
          data={weekly}
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
          ]}
        />
      </Card>

      {/* Enrollment by facility — all-sites view only (one bar per site). */}
      {!siteSelected && (
        <Card>
          <SectionTitle
            title={t("charts.enrollmentByFacility")}
            subtitle={t("charts.enrollmentByFacilitySub")}
          />
          <MultiBar
            data={facilities as unknown as Record<string, unknown>[]}
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
              trendView === "grid" ? "charts.enrollmentTrendsBySiteSubGrid" : "charts.enrollmentTrendsBySiteSub",
            )}
            action={
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
                  {(["grid", "line"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setTrendView(v)}
                      className={`px-3 py-1.5 ${
                        trendView === v
                          ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                          : "hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {t(v === "grid" ? "charts.viewGrid" : "charts.viewLine")}
                    </button>
                  ))}
                </div>
                {granularityBadge}
              </div>
            }
          />

          {trendView === "line" ? (
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
          ) : (
            <div className="space-y-5">
              {(
                [
                  [t("charts.enrolledSeries"), trendsBySite.enrolled, PALETTE.primary, trendMax.enrolled],
                  [t("charts.casesSeries"), trendsBySite.cases, PALETTE.pos, trendMax.cases],
                  [t("charts.controlsSeries"), trendsBySite.controls, PALETTE.neg, trendMax.controls],
                ] as const
              ).map(([label, data, color, max]) => (
                <div key={label}>
                  <div className="muted text-xs font-medium mb-2">{label}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                    {trendsBySite.sites.map((site) => {
                      const total = data.reduce((sum, row) => sum + ((row[site.name] as number) || 0), 0);
                      return (
                        <div key={site.mrc} className="rounded-lg border border-[var(--border)] p-2">
                          <div className="flex items-center justify-between gap-2 text-xs mb-1">
                            <span className="font-medium truncate" title={site.name}>
                              {site.name}
                            </span>
                            <span className="muted tabular-nums shrink-0">{total}</span>
                          </div>
                          <MiniBar data={data} xKey="week" dataKey={site.name} color={color} domainMax={max} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
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
          <SectionTitle title={t("charts.ageDistribution")} subtitle={t("charts.ageDistributionSub")} />
          <MultiBar
            data={ages as unknown as Record<string, unknown>[]}
            xKey="label"
            stacked
            series={[
              { key: "Male", name: t("charts.male"), color: PALETTE.neg },
              { key: "Female", name: t("charts.female"), color: PALETTE.grey },
            ]}
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
  downloadQuery,
}: SectionProps) {
  const t = useTranslations();
  const summary = useMemo(
    () => verificationSummary(enrollees, completedBarcodes),
    [enrollees, completedBarcodes],
  );
  const byFacility = useMemo(() => {
    const map = new Map<string, { name: string; needed: number; completed: number; outstanding: number }>();
    for (const e of enrollees.filter((x) => x.need_vac_cov === 1 && x.barcode)) {
      const mrc = e.mrc ?? "?";
      let r = map.get(mrc);
      if (!r) {
        r = { name: facilityNames.get(mrc) ?? `Site ${mrc}`, needed: 0, completed: 0, outstanding: 0 };
        map.set(mrc, r);
      }
      r.needed += 1;
      if (completedBarcodes.has(e.barcode as string)) r.completed += 1;
      else r.outstanding += 1;
    }
    return [...map.values()].sort((a, b) => b.needed - a.needed);
  }, [enrollees, completedBarcodes, facilityNames]);

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
        <SectionTitle title={t("verification.byFacility")} />
        <VerificationByFacilityTable rows={byFacility} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DataQualitySection({ issues, facilityNames, downloadQuery }: SectionProps) {
  const t = useTranslations();
  return (
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
