import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale, getTimeZone } from "next-intl/server";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import type { Locale } from "@/lib/types";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AVERT study",
  description:
    "Assessing Vaccine Effectiveness of R21/Matrix-M across malaria Transmission settings",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = (await getLocale()) as Locale;
  const timeZone = await getTimeZone();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <LocaleProvider initialLocale={locale} timeZone={timeZone}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
