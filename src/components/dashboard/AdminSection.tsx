"use client";

import { startTransition, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, SectionTitle } from "@/components/ui";

type ExportLinks = Partial<Record<"enrollee" | "vaccination_status" | "blood_smear", string>>;

interface ExportResult {
  links: ExportLinks;
  rowCounts: Record<string, number>;
  expiresAt: string;
  expiresHours: number;
}

interface ExportHistoryRow {
  requested_by: string;
  row_counts: Record<string, number>;
  expires_at: string;
  created_at: string;
}

const TABLE_LABELS: Record<string, string> = {
  enrollee: "Enrollee",
  vaccination_status: "Vaccination status",
  blood_smear: "Blood smear",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * Full (unblinded) dataset export: admin-only. Generates time-limited signed
 * links rather than emailing the data directly — see the AVERT blinding
 * discussion (Aug 2026): a link expires on its own and doesn't leave a
 * permanent copy of names/RDT results sitting in an inbox the way an email
 * attachment would.
 */
export function AdminSection() {
  const t = useTranslations();
  const [expiresHours, setExpiresHours] = useState(48);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [history, setHistory] = useState<ExportHistoryRow[] | null>(null);

  const loadHistory = async () => {
    try {
      const res = await fetch("/api/admin/full_export/history");
      if (!res.ok) return;
      const body = await res.json();
      setHistory(body.exports ?? []);
    } catch {
      // History is a nice-to-have audit view; a failed fetch just leaves it empty.
    }
  };

  useEffect(() => {
    // Mount-time fetch, deferred via startTransition per this project's
    // react-hooks/set-state-in-effect rule — a plain async call here would
    // set state synchronously within the effect body.
    startTransition(() => {
      void loadHistory();
    });
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/full_export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresHours }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      setResult(await res.json());
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle title={t("admin.exportTitle")} subtitle={t("admin.exportIntro")} />
        <div className="flex flex-wrap items-end gap-3 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span className="muted text-xs font-medium">{t("admin.linkExpiry")}</span>
            <select
              value={expiresHours}
              onChange={(e) => setExpiresHours(Number(e.target.value))}
              className="select"
            >
              <option value={24}>{t("admin.hours", { n: 24 })}</option>
              <option value={48}>{t("admin.hours", { n: 48 })}</option>
            </select>
          </label>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {generating ? t("admin.generating") : t("admin.generate")}
          </button>
        </div>

        {error && <p className="text-sm text-[var(--error)] mb-4">{error}</p>}

        {result && (
          <div className="border border-[var(--border)] rounded-lg p-4 space-y-2">
            <p className="text-sm muted">
              {t("admin.expiresAt")}: <span className="font-medium text-[var(--text)]">{fmt(result.expiresAt)}</span>
            </p>
            {Object.entries(result.links).length === 0 ? (
              <p className="text-sm muted">{t("admin.noRows")}</p>
            ) : (
              <ul className="space-y-1.5">
                {Object.entries(result.links).map(([table, url]) => (
                  <li key={table} className="flex items-center gap-2 text-sm">
                    <span className="font-medium min-w-40">
                      {TABLE_LABELS[table] ?? table} ({result.rowCounts[table]})
                    </span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] underline truncate"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title={t("admin.historyTitle")} subtitle={t("admin.historyIntro")} />
        {!history || history.length === 0 ? (
          <p className="text-sm muted">{t("admin.noHistory")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left muted border-b border-[var(--border)]">
                  <th className="py-2 pr-4">{t("admin.requestedBy")}</th>
                  <th className="py-2 pr-4">{t("admin.rowCounts")}</th>
                  <th className="py-2 pr-4">{t("admin.generatedAt")}</th>
                  <th className="py-2 pr-4">{t("admin.expiresAt")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-4">{h.requested_by}</td>
                    <td className="py-2 pr-4">
                      {Object.entries(h.row_counts)
                        .map(([k, v]) => `${TABLE_LABELS[k] ?? k}: ${v}`)
                        .join(", ")}
                    </td>
                    <td className="py-2 pr-4">{fmt(h.created_at)}</td>
                    <td className="py-2 pr-4">{fmt(h.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
