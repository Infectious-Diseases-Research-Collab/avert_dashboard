import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import type { Locale } from "@/lib/types";

export const LOCALES: Locale[] = ["en", "fr"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "AVERT_LOCALE";

/**
 * Resolve the active locale from the AVERT_LOCALE cookie (set from the user's
 * default_locale on first login, and toggled by the language switcher).
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value as Locale | undefined;
  const locale: Locale =
    cookieLocale && LOCALES.includes(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
