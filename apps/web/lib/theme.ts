import { ThemeSchema, type Theme } from "@isms/contracts";

export type { Theme };

/**
 * Colour theme preference. It belongs to the user and is saved on their account (#2); this
 * cookie only caches it so the server can render `data-theme` on <html> with no flash of the
 * wrong theme. Sign-in sets it from the account and sign-out clears it, so the next person on
 * a shared browser never inherits it. "system" renders no attribute: tokens.css then follows
 * `prefers-color-scheme`.
 */
export const THEME_COOKIE = "isms_theme";
export const THEMES = ThemeSchema.options;
export const THEME_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Options for setting the cookie from a route handler; the browser sets the same ones. */
export function themeCookieOptions(secure: boolean) {
  return { path: "/", maxAge: THEME_COOKIE_MAX_AGE_S, sameSite: "lax" as const, secure };
}

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((t) => t === value) ?? "system";
}

export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
