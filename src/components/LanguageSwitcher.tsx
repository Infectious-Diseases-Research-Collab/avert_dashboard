"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/i18n/locale";
import type { Locale } from "@/lib/types";

export function LanguageSwitcher() {
  const active = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  function choose(locale: Locale) {
    if (locale === active) return;
    startTransition(async () => {
      await setLocale(locale);
    });
  }

  return (
    <div
      className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-sm"
      aria-busy={pending}
    >
      {(["en", "fr"] as Locale[]).map((l) => (
        <button
          key={l}
          onClick={() => choose(l)}
          className={`px-3 py-1.5 font-medium transition-colors ${
            active === l
              ? "bg-[var(--primary)] text-[var(--primary-fg)]"
              : "hover:bg-[var(--surface-2)]"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
