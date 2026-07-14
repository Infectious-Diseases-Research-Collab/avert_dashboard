"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, SectionTitle, StatCard, EmptyState, fmtPct } from "@/components/ui";
import { MultiLine, MultiBar, PALETTE } from "@/components/charts";
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
  completedBarcodes: Set<string>;
  issues: DataQualityIssue[];
  downloadQuery: string;
}

// ---------------------------------------------------------------------------

export function OverviewSection({ enrollees, testType, facilityNames }: SectionProps) {
  const t = useTranslations();
  const kpis = useMemo(() => computeKpis(enrollees, testType), [enrollees, testType]);
  const weekly = useMemo(() => weeklyTrends(enrollees), [enrollees]);
  const hasMicro = weekly.some((w) => w["Micro+"] + w["Micro-"] > 0);
  const facilities = useMemo(
    () => enrollmentByFacility(enrollees, testType, facilityNames),
    [enrollees, testType, facilityNames],
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
        <SectionTitle title={t("charts.weeklyTrends")} />
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
  const doses = useMemo(() => doseDistribution(enrollees), [enrollees]);
  const coverage = useMemo(() => coverageByWeek(enrollees), [enrollees]);
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
          <SectionTitle title={t("charts.coverageByWeek")} />
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

export function DataQualitySection({ issues, facilityNames }: SectionProps) {
  const t = useTranslations();
  return (
    <Card>
      <SectionTitle title={t("dataQuality.title")} subtitle={t("dataQuality.intro")} />
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
