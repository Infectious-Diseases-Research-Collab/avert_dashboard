"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, fmtNum, fmtPct } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { DataQualityIssue } from "@/lib/types";
import type { DemogColumn, MatchScenario, Concordance } from "@/lib/metrics";

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-medium muted px-3 py-2 border-b border-[var(--border)] ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 border-b border-[var(--border)] tabular-nums ${className}`}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

export function DemographicsTable({
  data,
}: {
  data: { overall: DemogColumn; cases: DemogColumn; controls: DemogColumn };
}) {
  const t = useTranslations();
  const cols: [string, DemogColumn][] = [
    [t("tables.overall"), data.overall],
    [t("kpi.cases"), data.cases],
    [t("kpi.controls"), data.controls],
  ];
  const pct = (n: number, d: number) => (d ? ` (${((n / d) * 100).toFixed(0)}%)` : "");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>{t("tables.metric")}</Th>
            {cols.map(([name]) => (
              <Th key={name} className="text-right">
                {name}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            [t("tables.n"), (c: DemogColumn) => String(c.n)],
            [t("charts.male"), (c: DemogColumn) => `${c.male}${pct(c.male, c.n)}`],
            [t("charts.female"), (c: DemogColumn) => `${c.female}${pct(c.female, c.n)}`],
            [t("tables.meanAge"), (c: DemogColumn) => fmtNum(c.meanAge)],
            [t("tables.medianAge"), (c: DemogColumn) => fmtNum(c.medianAge, 0)],
            [
              t("tables.ageRange"),
              (c: DemogColumn) => (c.minAge == null ? "—" : `${c.minAge}–${c.maxAge}`),
            ],
          ].map(([label, fn]) => (
            <tr key={label as string}>
              <Td>{label as string}</Td>
              {cols.map(([name, c]) => (
                <Td key={name} className="text-right">
                  {(fn as (c: DemogColumn) => string)(c)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case-control matching
// ---------------------------------------------------------------------------

export function MatchingTable({ data }: { data: MatchScenario[] }) {
  const t = useTranslations();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>{t("tables.scenario")}</Th>
            <Th className="text-right">{t("tables.matchedPairs")}</Th>
            <Th className="text-right">{t("tables.unmatchedCases")}</Th>
            <Th className="text-right">{t("tables.unusedControls")}</Th>
            <Th className="text-right">{t("tables.fractionDiscarded")}</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.scenario}>
              <Td>{s.scenario}</Td>
              <Td className="text-right">{s.matchedPairs}</Td>
              <Td className="text-right">{s.unmatchedCases}</Td>
              <Td className="text-right">{s.unusedControls}</Td>
              <Td className="text-right">{fmtPct(s.fractionDiscarded * 100)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Concordance + crosstab
// ---------------------------------------------------------------------------

export function ConcordanceTable({ c }: { c: Concordance }) {
  const t = useTranslations();
  const rows = [
    [t("tables.sensitivity"), c.sensitivity],
    [t("tables.specificity"), c.specificity],
    [t("tables.ppv"), c.ppv],
    [t("tables.npv"), c.npv],
    [t("tables.agreement"), c.agreement],
  ] as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>{t("tables.metric")}</Th>
            <Th className="text-right">{t("tables.value")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label}>
              <Td>{label}</Td>
              <Td className="text-right">{fmtPct(v)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification by facility
// ---------------------------------------------------------------------------

export function VerificationByFacilityTable({
  rows,
}: {
  rows: { name: string; needed: number; completed: number; outstanding: number }[];
}) {
  const t = useTranslations();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>{t("filters.facility")}</Th>
            <Th className="text-right">{t("kpi.needed")}</Th>
            <Th className="text-right">{t("kpi.completed")}</Th>
            <Th className="text-right">{t("kpi.outstanding")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <Td>{r.name}</Td>
              <Td className="text-right">{r.needed}</Td>
              <Td className="text-right">{r.completed}</Td>
              <Td className="text-right">{r.outstanding}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data-quality issues (sortable / filterable)
// ---------------------------------------------------------------------------

type SortKey = "severity" | "check_code" | "status" | "detected_at";

export function DataQualityTable({
  issues,
  facilityNames,
}: {
  issues: DataQualityIssue[];
  facilityNames: Map<string, string>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "detected_at",
    dir: -1,
  });
  // Optimistic overlay of status changes made this session (issue id -> status),
  // so a dismissed/reopened row updates immediately without refetching.
  const [overrides, setOverrides] = useState<Map<number, DataQualityIssue["status"]>>(new Map());
  const [pending, setPending] = useState<Set<number>>(new Set());

  const effStatus = (i: DataQualityIssue) => overrides.get(i.id) ?? i.status;

  async function changeStatus(id: number, next: "open" | "dismissed") {
    setPending((p) => new Set(p).add(id));
    const supabase = createClient();
    const { error } = await supabase.rpc("set_issue_status", { p_id: id, p_status: next });
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    if (!error) setOverrides((m) => new Map(m).set(id, next));
  }

  const filtered = useMemo(() => {
    let rows = issues;
    if (status !== "all") rows = rows.filter((i) => (overrides.get(i.id) ?? i.status) === status);
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((i) =>
        [i.check_code, i.subjid, i.barcode, i.description, i.description_fr]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
      );
    }
    const order = { error: 0, warning: 1, info: 2 } as Record<string, number>;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sort.key === "severity") cmp = order[a.severity] - order[b.severity];
      else if (sort.key === "status") cmp = effStatus(a).localeCompare(effStatus(b));
      else cmp = String(a[sort.key]).localeCompare(String(b[sort.key]));
      return cmp * sort.dir;
    });
    // effStatus/overrides intentionally drive re-sort/re-filter on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, status, q, sort, overrides]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const SortTh = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      onClick={() => toggleSort(k)}
      className="text-left font-medium muted px-3 py-2 border-b border-[var(--border)] cursor-pointer select-none hover:text-[var(--text)]"
    >
      {children}
      {sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
          {(["open", "resolved", "dismissed", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 ${
                status === s ? "bg-[var(--primary)] text-[var(--primary-fg)]" : "hover:bg-[var(--surface-2)]"
              }`}
            >
              {t(`dataQuality.${s}`)}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("dataQuality.search")}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--primary)] flex-1 min-w-[180px]"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="muted text-sm py-8 text-center">{t("dataQuality.noIssues")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <SortTh k="severity">{t("dataQuality.severity")}</SortTh>
                <SortTh k="check_code">{t("dataQuality.check")}</SortTh>
                <Th>{t("dataQuality.subject")}</Th>
                <Th>{t("filters.facility")}</Th>
                <Th>{t("tables.description")}</Th>
                <SortTh k="status">{t("dataQuality.status")}</SortTh>
                <SortTh k="detected_at">{t("dataQuality.detected")}</SortTh>
                <Th>{t("dataQuality.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const st = effStatus(i);
                const busy = pending.has(i.id);
                return (
                  <tr key={i.id}>
                    <Td>
                      <Badge tone={i.severity}>{i.severity}</Badge>
                    </Td>
                    <Td className="font-mono text-xs">{i.check_code}</Td>
                    <Td>{i.subjid ?? i.barcode ?? "—"}</Td>
                    <Td>{i.mrc ? (facilityNames.get(i.mrc) ?? i.mrc) : "—"}</Td>
                    <Td className="max-w-[380px] whitespace-normal">
                      {locale === "fr" ? i.description_fr : i.description}
                    </Td>
                    <Td>
                      <Badge tone={st}>{t(`dataQuality.${st}`)}</Badge>
                    </Td>
                    <Td className="text-xs">{i.detected_at.slice(0, 10)}</Td>
                    <Td>
                      <button
                        onClick={() => changeStatus(i.id, st === "dismissed" ? "open" : "dismissed")}
                        disabled={busy}
                        className="text-xs rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-2)] disabled:opacity-50 whitespace-nowrap"
                      >
                        {st === "dismissed" ? t("dataQuality.reopen") : t("dataQuality.dismiss")}
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
