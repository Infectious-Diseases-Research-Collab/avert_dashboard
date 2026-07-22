"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  OverviewSection,
  VaccineCoverageSection,
  MicroscopySection,
  VerificationSection,
  DataQualitySection,
  DownloadSection,
} from "@/components/dashboard/sections";
import type { TestType } from "@/lib/metrics";
import type { Country, DataQualityIssue, Enrollee, Facility, Profile } from "@/lib/types";

type SectionKey =
  | "overview"
  | "vaccineCoverage"
  | "microscopy"
  | "verification"
  | "dataQuality"
  | "download";

const SECTIONS: Record<SectionKey, React.ComponentType<React.ComponentProps<typeof OverviewSection>>> = {
  overview: OverviewSection,
  vaccineCoverage: VaccineCoverageSection,
  microscopy: MicroscopySection,
  verification: VerificationSection,
  dataQuality: DataQualitySection,
  download: DownloadSection,
};

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function DashboardShell({
  profile,
  facilities,
  enrollees,
  completedBarcodes,
  issues,
  villageLookup,
}: {
  profile: Profile;
  facilities: Facility[];
  enrollees: Enrollee[];
  completedBarcodes: string[];
  issues: DataQualityIssue[];
  villageLookup: [string, string][];
}) {
  const t = useTranslations();
  const canSwitchCountry = profile.country_access === "BOTH";

  const [section, setSection] = useState<SectionKey>("overview");
  const [country, setCountry] = useState<Country | "ALL">(
    canSwitchCountry ? "ALL" : (profile.country_access as Country),
  );
  const [mrc, setMrc] = useState<string>("all");
  const [from, setFrom] = useState<string>(daysAgoISO(180));
  const [to, setTo] = useState<string>(new Date().toISOString().slice(0, 10));
  const [testType, setTestType] = useState<TestType>("rdt");

  const completedSet = useMemo(() => new Set(completedBarcodes), [completedBarcodes]);

  // Facilities available for the current country filter.
  const facilityOptions = useMemo(
    () => facilities.filter((f) => country === "ALL" || f.country === country),
    [facilities, country],
  );
  const facilityNames = useMemo(
    () => new Map(facilities.map((f) => [f.mrc, f.name])),
    [facilities],
  );
  const villageNames = useMemo(() => new Map(villageLookup), [villageLookup]);

  const filtered = useMemo(() => {
    return enrollees.filter((e) => {
      if (country !== "ALL" && e.country !== country) return false;
      if (mrc !== "all" && e.mrc !== mrc) return false;
      if (e.startdate) {
        if (from && e.startdate < from) return false;
        if (to && e.startdate > to) return false;
      }
      return true;
    });
  }, [enrollees, country, mrc, from, to]);

  const filteredIssues = useMemo(
    () => issues.filter((i) => (country === "ALL" ? true : i.country === country)),
    [issues, country],
  );

  const downloadQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (country !== "ALL") p.set("country", country);
    if (mrc !== "all") p.set("mrc", mrc);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [country, mrc, from, to]);

  const Section = SECTIONS[section];
  const sectionProps = {
    enrollees: filtered,
    testType,
    facilityNames,
    villageNames,
    completedBarcodes: completedSet,
    issues: filteredIssues,
    downloadQuery,
    siteSelected: mrc !== "all",
  };

  const navItems: SectionKey[] = [
    "overview",
    "vaccineCoverage",
    "microscopy",
    "verification",
    "dataQuality",
    "download",
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center justify-between px-5 h-14">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] grid place-items-center font-bold text-sm">
              A
            </div>
            <div className="min-w-0">
              <div className="font-semibold leading-none">{t("app.title")}</div>
              <div className="muted text-xs truncate">{t("app.subtitle")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="muted text-sm hidden sm:block">{profile.full_name ?? profile.email}</span>
            <a
              href="/reset-password"
              className="text-sm rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)] hidden sm:inline-block"
            >
              {t("auth.changePassword")}
            </a>
            <form action="/auth/signout" method="post">
              <button className="text-sm rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-2)]">
                {t("nav.signOut")}
              </button>
            </form>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="px-3 flex gap-1 overflow-x-auto">
          {navItems.map((key) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                section === key
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent muted hover:text-[var(--text)]"
              }`}
            >
              {t(`nav.${key}`)}
            </button>
          ))}
        </nav>
      </header>

      {/* Filter bar */}
      <div className="bg-[var(--surface-2)] border-b border-[var(--border)] px-5 py-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          {canSwitchCountry && (
            <Field label={t("filters.country")}>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value as Country | "ALL");
                  setMrc("all");
                }}
                className="select"
              >
                <option value="ALL">{t("countries.all")}</option>
                <option value="UG">{t("countries.UG")}</option>
                <option value="BF">{t("countries.BF")}</option>
              </select>
            </Field>
          )}
          <Field label={t("filters.facility")}>
            <select value={mrc} onChange={(e) => setMrc(e.target.value)} className="select">
              <option value="all">{t("filters.allFacilities")}</option>
              {facilityOptions.map((f) => (
                <option key={`${f.country}-${f.mrc}`} value={f.mrc}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("filters.from")}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="select" />
          </Field>
          <Field label={t("filters.to")}>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="select" />
          </Field>
          <Field label={t("filters.caseDefinition")}>
            <select
              value={testType}
              onChange={(e) => setTestType(e.target.value as TestType)}
              className="select"
            >
              <option value="rdt">{t("filters.rdt")}</option>
              <option value="microscopy">{t("filters.microscopy")}</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 p-5 max-w-[1400px] w-full mx-auto">
        <Section {...sectionProps} />
      </main>

      <style>{`
        .select {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 6px 10px;
          color: var(--text);
          outline: none;
        }
        .select:focus { border-color: var(--primary); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="muted text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}
