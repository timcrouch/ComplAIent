"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { THEME_COOKIE, themeAttribute, type Theme } from "../../lib/theme";
import { Segmented } from "./segmented";

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** Applies a theme now (data-theme on <html>) and stores it for the server's next render. */
export function applyTheme(theme: Theme): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${String(ONE_YEAR_S)}; samesite=lax${secure}`;
  const attribute = themeAttribute(theme);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
}

/** The opposite of what is on screen now ("system" resolves through the OS preference). */
export function oppositeTheme(): "light" | "dark" {
  const current =
    document.documentElement.dataset.theme ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  return current === "dark" ? "light" : "dark";
}

const icon = "size-3.5";

export function ThemeToggle({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  const t = useTranslations("theme");
  return (
    <Segmented
      legend={t("legend")}
      name="theme"
      value={value}
      onChange={onChange}
      options={[
        { value: "light", label: t("light"), icon: <SunIcon aria-hidden className={icon} /> },
        { value: "dark", label: t("dark"), icon: <MoonIcon aria-hidden className={icon} /> },
        { value: "system", label: t("system"), icon: <MonitorIcon aria-hidden className={icon} /> },
      ]}
    />
  );
}
