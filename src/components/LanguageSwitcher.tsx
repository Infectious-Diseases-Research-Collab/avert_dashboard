"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useChangeLocale } from "@/i18n/LocaleProvider";
import type { Locale } from "@/lib/types";

/**
 * `refresh` also re-renders the page on the server, for pages whose text comes
 * from server-side getTranslations (login, reset-password). Leave it off on
 * /dashboard, where everything is client-rendered and a refresh would
 * re-fetch all the study data.
 */
export function LanguageSwitcher({ refresh = false }: { refresh?: boolean }) {
  const active = useLocale() as Locale;
  const changeLocale = useChangeLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(locale: Locale) {
    if (locale === active) return;
    const saved = changeLocale(locale);
    if (refresh) {
      startTransition(async () => {
        await saved;
        router.refresh();
      });
    }
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
