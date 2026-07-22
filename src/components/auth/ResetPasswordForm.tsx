"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

/**
 * Set a new password. Reached either via a reset-email recovery session or by
 * a signed-in user choosing "Change password" — in both cases the session is
 * already established, so this just calls updateUser({ password }).
 */
export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => window.location.assign("/dashboard"), 1200);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">{t("newPassword")}</label>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--primary)]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t("confirmPassword")}</label>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--primary)]"
        />
      </div>

      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
      {done && <p className="text-sm text-[var(--good)]">{t("passwordUpdated")}</p>}

      <button
        type="submit"
        disabled={loading || done}
        className="w-full rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] py-2.5 font-medium disabled:opacity-60"
      >
        {loading ? t("updatingPassword") : t("updatePassword")}
      </button>
    </form>
  );
}
