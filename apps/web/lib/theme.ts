/**
 * Colour theme preference, stored in a cookie so the server can render `data-theme` on <html>
 * (no flash of the wrong theme). "system" renders no attribute: tokens.css then follows
 * `prefers-color-scheme`.
 */
export const THEME_COOKIE = "isms_theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((t) => t === value) ?? "system";
}

export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
