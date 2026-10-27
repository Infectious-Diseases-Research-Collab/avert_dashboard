"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { setLocale } from "@/i18n/locale";
import type { Locale } from "@/lib/types";
import enMessages from "../../messages/en.json";
import frMessages from "../../messages/fr.json";

const MESSAGES = { en: enMessages, fr: frMessages } as const;

type ChangeLocale = (locale: Locale) => Promise<void>;

const ChangeLocaleContext = createContext<ChangeLocale | null>(null);

/**
 * Holds the UI locale on the client so switching language is instant. Both
 * message files are small and bundled, and every translated view is a client
 * component, so there is no need for a server re-render — which on /dashboard
 * would re-fetch every table just to change UI strings. The cookie is still
 * written (via the setLocale server action) so the choice survives a reload.
 */
export function LocaleProvider({
  initialLocale,
  timeZone,
  children,
}: {
  initialLocale: Locale;
  timeZone: string;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const changeLocale = useCallback<ChangeLocale>((next) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    return setLocale(next);
  }, []);

  return (
    <ChangeLocaleContext.Provider value={changeLocale}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone={timeZone}>
        {children}
      </NextIntlClientProvider>
    </ChangeLocaleContext.Provider>
  );
}

/** Switch the UI locale; resolves once the cookie has been persisted. */
export function useChangeLocale(): ChangeLocale {
  const ctx = useContext(ChangeLocaleContext);
  if (!ctx) throw new Error("useChangeLocale must be used inside LocaleProvider");
  return ctx;
}
