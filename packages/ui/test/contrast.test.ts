// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokens, type ThemeName } from "../src/tokens/tokens";
import { contrast, over } from "./contrast";

describe("contrast helper", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
  it("composites translucent colours over an opaque backdrop", () => {
    expect(over("rgba(255, 255, 255, 0.5)", "#000000")).toBe("rgba(128, 128, 128, 1)");
  });
});

const themes: ThemeName[] = ["light", "dark"];

for (const theme of themes) {
  describe(`${theme} theme`, () => {
    const t = tokens[theme];
    // Every opaque page backdrop the translucent surface can sit on.
    const backdrops = [t.bg, t.bgGradientFrom, t.bgGradientTo];
    const surfaces = backdrops.map((b) => over(t.surface, b));

    it.each([
      ["text", t.text],
      ["textMuted", t.textMuted],
    ])("%s ≥ 4.5 on bg and on surface", (_name, fg) => {
      for (const b of backdrops) expect(contrast(fg, b)).toBeGreaterThanOrEqual(4.5);
      for (const s of surfaces) expect(contrast(fg, s)).toBeGreaterThanOrEqual(4.5);
    });

    it("accentText on accent ≥ 4.5", () => {
      expect(contrast(t.accentText, t.accent)).toBeGreaterThanOrEqual(4.5);
    });

    it("accent used as link / AI text ≥ 4.5 on its soft background and on surface", () => {
      expect(contrast(t.accent, t.accentSoft)).toBeGreaterThanOrEqual(4.5);
      for (const s of surfaces) expect(contrast(t.accent, s)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["ok", "attention", "critical", "info"] as const)(
      "%s text on its soft bg ≥ 4.5",
      (status) => {
        expect(contrast(t[status], t[`${status}Soft`])).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(["chartBlue", "chartTeal"] as const)(
      "%s text ≥ 4.5 on its soft pair and on surface",
      (name) => {
        expect(contrast(t[name], t[`${name}Soft`])).toBeGreaterThanOrEqual(4.5);
        for (const s of surfaces) expect(contrast(t[name], s)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it("critical (above appetite) ≥ 4.5 on its soft bg and on surface", () => {
      expect(contrast(t.critical, t.criticalSoft)).toBeGreaterThanOrEqual(4.5);
      for (const s of surfaces) expect(contrast(t.critical, s)).toBeGreaterThanOrEqual(4.5);
    });

    it("focus ring ≥ 3 against bg and surface", () => {
      for (const b of backdrops) expect(contrast(t.focusRing, b)).toBeGreaterThanOrEqual(3);
      for (const s of surfaces) expect(contrast(t.focusRing, s)).toBeGreaterThanOrEqual(3);
    });

    it("control border ≥ 3 against bg and surface (WCAG 1.4.11)", () => {
      for (const b of backdrops) expect(contrast(t.controlBorder, b)).toBeGreaterThanOrEqual(3);
      for (const s of surfaces) expect(contrast(t.controlBorder, s)).toBeGreaterThanOrEqual(3);
    });
  });
}

describe("tokens.css mirrors tokens.ts", () => {
  const css = readFileSync(new URL("../src/tokens/tokens.css", import.meta.url), "utf8");
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  // Prettier lowercases hex and may wrap long values, so compare normalised text.
  const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

  function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0);
    return norm(css.slice(start, css.indexOf("}", start)));
  }

  it.each([
    ["light", ':root,\n[data-theme="light"]'],
    ["dark", '[data-theme="dark"]'],
    ["dark", ':root:not([data-theme="light"])'],
  ] as const)("%s values appear in %s", (theme, selector) => {
    const body = block(selector);
    const { shadow, ...colors } = tokens[theme];
    for (const [key, value] of Object.entries(colors)) {
      expect(body).toContain(norm(`--isms-${kebab(key)}: ${value};`));
    }
    expect(body).toContain(norm(`--isms-shadow-sm: ${shadow.sm};`));
    expect(body).toContain(norm(`--isms-shadow-lg: ${shadow.lg};`));
  });

  it("defines radius, motion and easing from tokens.ts", () => {
    for (const [k, v] of Object.entries(tokens.radius)) {
      expect(css).toContain(`--radius-${k}: ${String(v)}px;`);
    }
    for (const [k, v] of Object.entries(tokens.motion)) {
      expect(css).toContain(`--motion-${k}: ${String(v)}ms;`);
    }
    expect(css).toContain(`--ease-standard: ${tokens.easing};`);
  });

  it("defines the label and value type from tokens.ts and exposes them to Tailwind", () => {
    const { label, value } = tokens.type;
    expect(css).toContain(`--isms-label-size: ${String(label.size)}px;`);
    expect(css).toContain(`--isms-label-weight: ${String(label.weight)};`);
    expect(css).toContain(`--isms-label-leading: ${String(label.leading)};`);
    expect(css).toContain(`--isms-value-size: ${String(value.size)}px;`);
    expect(css).toContain(`--isms-value-weight-short: ${String(value.weightShort)};`);
    expect(css).toContain(`--isms-value-weight-long: ${String(value.weightLong)};`);
    expect(css).toContain(`--isms-value-leading: ${String(value.leading)};`);
    for (const name of ["--text-label:", "--text-value:", "--font-weight-value-short:"]) {
      expect(css).toContain(name);
    }
  });

  it("zeroes every --motion-* value under prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("}", css.indexOf("{", start) + 1));
    for (const k of Object.keys(tokens.motion)) expect(body).toContain(`--motion-${k}: 0ms;`);
  });

  it("makes dark the default under prefers-color-scheme: dark and exposes an @theme block", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toMatch(/@theme inline \{/);
    expect(css).toContain("--font-sans:");
  });

  it("resolves font-sans at runtime through --isms-font-sans so apps can set it", () => {
    const flat = norm(css);
    expect(flat).toMatch(/--font-sans: var\(\s*--isms-font-sans,\s*ui-sans-serif/);
  });
});
