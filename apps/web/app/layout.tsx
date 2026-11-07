import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { timeZoneScript } from "../lib/greeting";
import { parseTheme, THEME_COOKIE, themeAttribute } from "../lib/theme";
import "./globals.css";

// Self-hosted by next/font at build time: no request to Google from the browser.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jakarta",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("description") };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e17" },
  ],
};

/**
 * The theme cookie is read here, so `data-theme` is in the server HTML and the page never
 * flashes the wrong theme. "system" renders no attribute (tokens.css follows the OS).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={themeAttribute(theme)} className={jakarta.variable}>
      <head>
        {/* Records the browser's time zone for the server-rendered greeting (lib/greeting.ts). */}
        <script dangerouslySetInnerHTML={{ __html: timeZoneScript }} />
      </head>
      <body className="font-sans antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
