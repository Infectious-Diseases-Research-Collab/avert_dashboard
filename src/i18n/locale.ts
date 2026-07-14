"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Locale } from "@/lib/types";
import { LOCALE_COOKIE, LOCALES } from "./request";

/** Server action: persist the chosen UI locale to a cookie. */
export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
