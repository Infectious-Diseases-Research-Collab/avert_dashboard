"use client";

import { useTranslations } from "next-intl";

/** Shown while the dashboard fetches study data, which takes a while on a slow connection. */
export default function Loading() {
  const t = useTranslations("app");
  return (
    <div className="min-h-screen grid place-items-center p-6" role="status">
      <div className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]"
        />
        <p className="muted text-sm">{t("loadingData")}</p>
      </div>
    </div>
  );
}
