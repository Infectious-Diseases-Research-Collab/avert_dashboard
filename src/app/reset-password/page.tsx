import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Set-new-password page. Reached with an active session — either a recovery
 * session (from the reset email via /auth/callback) or a signed-in user
 * choosing "Change password". Without a session, middleware sends to /login.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const t = await getTranslations();

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[var(--primary)] text-[var(--primary-fg)]">
        <div>
          <div className="text-sm font-medium opacity-80 tracking-wide uppercase">AVERT</div>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">{t("app.title")}</h1>
          <p className="mt-3 text-lg opacity-90 max-w-md">{t("app.subtitle")}</p>
        </div>
        <p className="text-sm opacity-70 max-w-sm">{t("auth.restricted")}</p>
      </div>

      <div className="flex flex-col">
        <div className="flex justify-end p-4">
          <LanguageSwitcher />
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-semibold mb-1">{t("auth.resetTitle")}</h2>
            <p className="muted text-sm mb-6">{t("auth.resetIntro")}</p>
            <ResetPasswordForm />
          </div>
        </div>
      </div>
    </div>
  );
}
