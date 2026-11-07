import { tokens } from "@isms/ui/tokens";
import { describe, expect, it } from "vitest";
import { TILE_ICON_SVG } from "../../src/reports/render/icons.js";
import {
  type TileColours,
  escapeXml,
  movementSvg,
  ownerBarSvg,
} from "../../src/reports/render/svg.js";
import { boardFixture } from "./fixtures.js";

const colours: TileColours = {
  accent: tokens.light.accent,
  critical: tokens.light.critical,
  chartBlue: tokens.light.chartBlue,
  chartTeal: tokens.light.chartTeal,
  ok: tokens.light.ok,
  attention: tokens.light.attention,
  textMuted: tokens.light.textMuted,
};

/** A tiny well-formedness check: every open tag closes in order. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, close, name = "", selfClose] = m;
    if (selfClose) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

const weeks = (f: (i: number) => Partial<ReturnType<typeof week>>) =>
  Array.from({ length: 12 }, (_, i) => ({ ...week(i), ...f(i) }));
const week = (i: number) => ({
  weekStart: new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10),
  reported: 0,
  approved: 0,
  closed: 0,
  openAtEnd: 0,
});

describe("escapeXml", () => {
  it("escapes markup characters", () => {
    expect(escapeXml('<A & "B">')).toBe("&lt;A &amp; &quot;B&quot;&gt;");
  });
});

describe("movementSvg", () => {
  it("is valid with all zeros: no NaN or Infinity, axis maximum 1", () => {
    const svg = movementSvg(
      weeks(() => ({})),
      colours,
      520,
      180,
    );
    expect(balanced(svg)).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain(">1</text>");
    expect(svg).not.toContain("Open risks");
  });

  it("draws bars in the tile colours, week labels and a legend", () => {
    const svg = movementSvg(boardFixture().movement, colours, 520, 180);
    expect(balanced(svg)).toBe(true);
    for (const c of [colours.chartBlue, colours.chartTeal, colours.ok, colours.accent])
      expect(svg).toContain(c);
    expect(svg).toContain("17 Aug");
    expect(svg).toContain("Reported");
    expect(svg).toContain("Treated");
    expect(svg).toContain("<polyline");
  });

  it("puts open risks on a labelled right axis when they dwarf the bars", () => {
    const svg = movementSvg(
      weeks(() => ({ reported: 3, openAtEnd: 120 })),
      colours,
      520,
      180,
    );
    expect(svg).toContain("Open risks");
    expect(svg).toContain(">120</text>");
    expect(balanced(svg)).toBe(true);
  });

  it("keeps the right axis title clear of the axis numbers, with a mid tick (#16)", () => {
    // The sample company: 77 open risks against weekly bars of 0 to 4 (P8-R4), at the board
    // pack's size.
    const svg = movementSvg(
      weeks((i) => ({ reported: i % 5, openAtEnd: 70 + (i % 8) })),
      colours,
      523,
      140,
    );
    const labels = [
      ...svg.matchAll(
        /<text x="[^"]+" y="([^"]+)"[^>]*font-size="([^"]+)" fill="([^"]+)"[^>]*>([^<]*)</g,
      ),
    ].map(([, y, size, fill, s = ""]) => ({ y: Number(y), size: Number(size), fill, s }));
    const title = labels.find((l) => l.s === "Open risks");
    if (!title) throw new Error("no axis title");
    const right = labels.filter((l) => l.fill === colours.accent && l !== title).map((l) => l.s);
    expect(right).toEqual(["0", "39", "77"]);
    // The title sits below the legend (labels on y = 13) and a font height clear of every tick.
    const ticks = labels.filter((l) => /^\d+$/.test(l.s));
    expect(ticks.length).toBeGreaterThan(3);
    expect(title.y - title.size).toBeGreaterThanOrEqual(13);
    for (const tick of ticks) expect(title.y + title.size).toBeLessThanOrEqual(tick.y - tick.size);
  });

  it("shares one axis when the scales are comparable", () => {
    const svg = movementSvg(
      weeks(() => ({ reported: 3, openAtEnd: 9 })),
      colours,
      520,
      180,
    );
    expect(svg).not.toContain("Open risks</text>");
  });
});

describe("ownerBarSvg", () => {
  const row = boardFixture().owners[0];
  it("stacks open then treated-now, scaled to the largest owner", () => {
    if (!row) throw new Error("fixture");
    const svg = ownerBarSvg(row, 14, colours, 120);
    expect(balanced(svg)).toBe(true);
    expect(svg.indexOf(colours.accent)).toBeLessThan(svg.indexOf(colours.ok));
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toContain("Oscar");
  });

  it("copes with a zero maximum", () => {
    if (!row) throw new Error("fixture");
    expect(ownerBarSvg({ ...row, owned: 0, open: 0, closedNow: 0 }, 0, colours, 120)).not.toMatch(
      /NaN|Infinity/,
    );
  });
});

describe("TILE_ICON_SVG", () => {
  it("fills the stroke colour at call time", () => {
    for (const key of Object.keys(TILE_ICON_SVG) as (keyof typeof TILE_ICON_SVG)[]) {
      const svg = TILE_ICON_SVG[key]("#123456");
      expect(svg).toContain('stroke="#123456"');
      expect(balanced(svg)).toBe(true);
    }
  });
});
