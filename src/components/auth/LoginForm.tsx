"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { setLocale } from "@/i18n/locale";
import type { Locale } from "@/lib/types";

export function LoginForm() {
  const t = useTranslations("auth");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function applyDefaultLocale(supabase: ReturnType<typeof createClient>) {
    const { data } = await supabase
      .from("allowed_users")
      .select("default_locale")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (data?.default_locale) await setLocale(data.default_locale as Locale);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(
            /not authorized/i.test(error.message)
              ? t("notAuthorized")
              : error.message,
          );
          return;
        }
        setNotice(t("checkEmail"));
        setMode("signin");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(t("invalidCredentials"));
        return;
      }
      await applyDefaultLocale(supabase);
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
