"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { setLocale } from "@/i18n/locale";
import type { Locale } from "@/lib/types";
import enMessages from "../../../messages/en.json";
import frMessages from "../../../messages/fr.json";

// Setting the locale cookie (a server action + revalidation) doesn't
// synchronously update the React tree, and a translated string once baked
// into local state (setNotice(t(...))) won't retroactively re-translate. So
// for the handful of messages that can fire mid-auth-flow — before the
// locale cookie's re-render has necessarily landed — resolve them directly
// against the message files using the locale we just looked up, rather than
// depending on the ambient (possibly stale) next-intl context.
const AUTH_STRINGS = { en: enMessages.auth, fr: frMessages.auth } as const;

export function LoginForm() {
  const t = useTranslations("auth");
  const activeLocale = useLocale() as Locale;
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Looked up via a narrow RPC (not a direct table select) so it works even
  // for a signed-out visitor mid-signup, before their account is confirmed.
  // Returns the resolved locale (or the current one, if this email isn't on
  // the allowlist) so the caller can use it immediately for this response.
  async function syncLocaleForEmail(supabase: ReturnType<typeof createClient>): Promise<Locale> {
    const { data } = await supabase.rpc("lookup_default_locale", {
      p_email: email.toLowerCase(),
    });
    if (data) {
      await setLocale(data as Locale);
      return data as Locale;
    }
    return activeLocale;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();

    try {
      // Switch to the account's assigned language before showing any
      // response, so both the signup confirmation and post-signin dashboard
      // render in the right language from the first paint.
      const locale = await syncLocaleForEmail(supabase);
      const strings = AUTH_STRINGS[locale];

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(/not authorized/i.test(error.message) ? strings.notAuthorized : error.message);
          return;
        }
        setNotice(strings.checkEmail);
        setMode("signin");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(strings.invalidCredentials);
        return;
      }
      window.location.assign("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">{t("email")}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--primary)]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t("password")}</label>
        <input
          type="password"
          required
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--primary)]"
        />
      </div>

      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
      {notice && <p className="text-sm text-[var(--good)]">{notice}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] py-2.5 font-medium disabled:opacity-60"
      >
        {loading ? t("signingIn") : mode === "signup" ? t("signUpButton") : t("signInButton")}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
          setNotice(null);
        }}
        className="w-full text-sm muted hover:text-[var(--primary)]"
      >
        {mode === "signup" ? t("toggleToSignIn") : t("toggleToSignUp")}
      </button>
    </form>
  );
}
