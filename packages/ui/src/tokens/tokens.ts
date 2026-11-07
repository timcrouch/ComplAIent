/**
 * Clear Glass design tokens — the single source of truth for colour, radius,
 * shadow and motion. `tokens.css` mirrors these values as CSS variables
 * (a test keeps the two in sync).
 *
 * Light values come from the approved "C · Clear Glass" mockup. The dark theme
 * is designed separately (deep cool slate, lifted accent), not inverted.
 *
 * Deviations from the mockup, made for WCAG 2.2 AA (each verified in
 * test/contrast.test.ts):
 * - light `attention` #A15C07 → #9C5906: the mockup pair on #FDEBD3 measures
 *   4.45:1; one step darker gives 4.68:1 with the same hue.
 * All other mockup values pass unchanged. `textMuted` #5B6380 measures 5.31:1
 * on the page background (its worst case) and 5.80:1 on the glass surface.
 *
 * Additions beyond the mockup:
 * - `controlBorder`: input/chip outlines need ≥ 3:1 against their
 *   surroundings (WCAG 1.4.11); the mockup's white-on-white card border is
 *   decorative only and is kept for cards as `surfaceBorder`.
 * - `critical`/`criticalSoft`: the mockup has no critical state. They also carry
 *   "above appetite" everywhere (badge, map cells, board pack): light 5.48:1 on
 *   `criticalSoft` and 6.43:1 on the glass surface (worst case); dark 7.30:1 and 7.62:1.
 * - `chartBlue`/`chartTeal` (+ `Soft`): the two board-pack chart series. Each is text-safe on
 *   its soft pair and on the glass surface (worst case over the page backdrops):
 *   light blue 5.06:1 / 6.08:1, light teal 5.38:1 / 6.30:1;
 *   dark blue 6.91:1 / 7.73:1, dark teal 7.73:1 / 8.89:1.
 */

export interface ThemeTokens {
  bg: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  /** Translucent card surface; composite over `bg` when measuring contrast. */
  surface: string;
  /** Decorative hairline around cards (not relied on to identify controls). */
  surfaceBorder: string;
  /** Boundary of interactive controls such as inputs and chips (≥ 3:1). */
  controlBorder: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  ok: string;
  okSoft: string;
  attention: string;
  attentionSoft: string;
  critical: string;
  criticalSoft: string;
  info: string;
  infoSoft: string;
  chartBlue: string;
  chartBlueSoft: string;
  chartTeal: string;
  chartTealSoft: string;
  focusRing: string;
  /** Scrim behind modal layers (dims the page; not a text background). */
  overlay: string;
  /** Two-layer shadows: `sm` for resting cards, `lg` for floating layers. */
  shadow: { sm: string; lg: string };
}

export type ThemeName = "light" | "dark";

const light: ThemeTokens = {
  bg: "#F3F5FB",
  bgGradientFrom: "#F3F5FB",
  bgGradientTo: "#F4F1FA",
  surface: "rgba(255, 255, 255, 0.78)",
  surfaceBorder: "rgba(255, 255, 255, 0.9)",
  controlBorder: "#8088A3",
  text: "#141A2E",
  textMuted: "#5B6380",
  accent: "#4F3FD9",
  accentText: "#FFFFFF",
  accentSoft: "#E6E3FF",
  ok: "#167A4C",
  okSoft: "#DDF3E8",
  attention: "#9C5906",
  attentionSoft: "#FDEBD3",
  critical: "#B42318",
  criticalSoft: "#FDE5E3",
  info: "#4F3FD9",
  infoSoft: "#E6E3FF",
  chartBlue: "#1B5FB8",
  chartBlueSoft: "#DCE9FA",
  chartTeal: "#0A6A64",
  chartTealSoft: "#D6F0ED",
  focusRing: "#4F3FD9",
  overlay: "rgba(20, 26, 46, 0.24)",
  shadow: {
    sm: "0 1px 2px rgba(20, 26, 46, 0.05), 0 4px 14px rgba(20, 26, 46, 0.05)",
    lg: "0 2px 6px rgba(20, 26, 46, 0.06), 0 18px 44px rgba(20, 26, 46, 0.14)",
  },
};

const dark: ThemeTokens = {
  bg: "#0B0E17",
  bgGradientFrom: "#0B0E17",
  bgGradientTo: "#110E1F",
  surface: "rgba(30, 35, 56, 0.66)",
  surfaceBorder: "rgba(255, 255, 255, 0.07)",
  controlBorder: "#6B7493",
  text: "#E9ECF5",
  textMuted: "#98A1BC",
  accent: "#8E80FF",
  accentText: "#0E0B26",
  accentSoft: "#231E4D",
  ok: "#4FD69C",
  okSoft: "#0E2A20",
  attention: "#F2B55A",
  attentionSoft: "#33250F",
  critical: "#FF8F8A",
  criticalSoft: "#3A1618",
  info: "#8E80FF",
  infoSoft: "#231E4D",
  chartBlue: "#7DB2FF",
  chartBlueSoft: "#12264A",
  chartTeal: "#4DD0C4",
  chartTealSoft: "#0C2E2B",
  focusRing: "#A79CFF",
  overlay: "rgba(3, 5, 12, 0.6)",
  shadow: {
    sm: "0 1px 2px rgba(0, 0, 0, 0.32), 0 6px 18px rgba(0, 0, 0, 0.22)",
    lg: "0 2px 8px rgba(0, 0, 0, 0.4), 0 24px 56px rgba(0, 0, 0, 0.5)",
  },
};

export const tokens = {
  light,
  dark,
  radius: { sm: 8, md: 12, lg: 16 },
  motion: { fast: 120, base: 200, slow: 320 },
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  /**
   * Label and value type for record details (DetailList): the system's label recedes (13px,
   * medium, muted) so the user's value (15px, full contrast) reads first. Short values (names,
   * sites, dates) are medium weight; long free text is regular for easier reading. Sizes in px.
   */
  type: {
    label: { size: 13, weight: 500, leading: 1.45 },
    value: { size: 15, weightShort: 500, weightLong: 400, leading: 1.6 },
  },
} as const;

export type Tokens = typeof tokens;
