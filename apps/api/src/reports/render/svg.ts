import type { BoardMovementWeekDto, BoardOwnerRowDto } from "@isms/contracts";
import type { TileToken } from "@isms/domain";
import { dayMonth } from "./common.js";

/** Light hex values from `@isms/ui/tokens`, keyed by the tile token names. */
export type TileColours = Record<TileToken, string>;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const n = (v: number): string => String(Math.round(v * 10) / 10);
const FONT = 'font-family="Roboto"';

const text = (x: number, y: number, s: string, size: number, fill: string, anchor = "start") =>
  `<text x="${n(x)}" y="${n(y)}" ${FONT} font-size="${String(size)}" fill="${fill}" text-anchor="${anchor}">${escapeXml(s)}</text>`;

/**
 * 12 weekly groups of three bars (reported, approved, treated) and a polyline of risks still
 * open at each week's end. When open risks dwarf the bars (more than 3 times the tallest bar,
 * P8-R4) the line gets its own labelled right-hand axis, with a mid tick. Axis maxima are never
 * below 1.
 *
 * Layout rule, shared with the web chart (#16): with its own axis, the plot starts low enough that
 * the axis title's baseline and height sit a font height clear of the top tick's baseline
 * (title + font <= tick - font).
 */
export function movementSvg(
  weeks: BoardMovementWeekDto[],
  c: TileColours,
  width: number,
  height: number,
): string {
  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.reported, w.approved, w.closed)));
  const maxOpen = Math.max(1, ...weeks.map((w) => w.openAtEnd));
  const own = maxOpen > 3 * maxBar;
  const leftMax = own ? maxBar : Math.max(maxBar, maxOpen);
  const rightMax = own ? maxOpen : leftMax;

  const font = 6;
  // A tick label's baseline sits this far below its tick, which centres it on the line.
  const tickDy = 2;
  // The right axis title sits under the legend, whose labels have their baseline on y = 13.
  const titleY = 21;
  const left = 26;
  const right = own ? 30 : 8;
  const top = own ? titleY + 2 * font - tickDy : 26;
  const bottom = 18;
  const pw = width - left - right;
  const ph = height - top - bottom;
  const gw = pw / Math.max(1, weeks.length);
  const bw = Math.min(8, gw * 0.22);
  const y = (v: number, max: number) => top + ph - (v / max) * ph;
  const parts: string[] = [];

  const series = [
    { label: "Reported", colour: c.chartBlue, key: "reported" as const },
    { label: "Approved", colour: c.chartTeal, key: "approved" as const },
    { label: "Treated", colour: c.ok, key: "closed" as const },
  ];

  // Legend.
  let lx = left;
  for (const s of [...series, { label: "Open at week end", colour: c.accent, key: null }]) {
    parts.push(`<rect x="${n(lx)}" y="6" width="8" height="8" fill="${s.colour}"/>`);
    parts.push(text(lx + 11, 13, s.label, 7, c.textMuted));
    lx += 11 + s.label.length * 3.6 + 12;
  }

  // Left axis (and gridlines).
  const ticks = leftMax >= 2 ? [0, leftMax / 2, leftMax] : [0, leftMax];
  for (const t of ticks) {
    const ty = y(t, leftMax);
    parts.push(
      `<line x1="${String(left)}" y1="${n(ty)}" x2="${n(width - right)}" y2="${n(ty)}" stroke="#DDDDDD" stroke-width="0.5"/>`,
    );
    parts.push(
      text(left - 3, ty + tickDy, String(Math.round(t * 10) / 10), font, c.textMuted, "end"),
    );
  }
  if (own) {
    parts.push(text(width - 2, titleY, "Open risks", font, c.accent, "end"));
    // The line's own axis exceeds 3, so it always has a whole-number middle.
    for (const t of [0, Math.round(rightMax / 2), rightMax])
      parts.push(text(width - right + 3, y(t, rightMax) + tickDy, String(t), font, c.accent));
  }

  weeks.forEach((w, i) => {
    const gx = left + i * gw + gw / 2 - (bw * 3) / 2;
    series.forEach((s, j) => {
      const h = (w[s.key] / leftMax) * ph;
      if (h > 0)
        parts.push(
          `<rect x="${n(gx + j * bw)}" y="${n(top + ph - h)}" width="${n(bw - 0.5)}" height="${n(h)}" fill="${s.colour}"/>`,
        );
    });
    parts.push(
      text(left + i * gw + gw / 2, height - 6, dayMonth(w.weekStart), 5.5, c.textMuted, "middle"),
    );
  });

  const pts = weeks.map((w, i) => ({
    x: left + i * gw + gw / 2,
    y: y(w.openAtEnd, rightMax),
  }));
  if (pts.length > 0) {
    parts.push(
      `<polyline points="${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" fill="none" stroke="${c.accent}" stroke-width="1.5"/>`,
    );
    for (const p of pts)
      parts.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="2" fill="${c.accent}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${parts.join("")}</svg>`;
}

/**
 * One horizontal stacked bar: risks still open (accent) then those treated now (ok), with the
 * two numbers beside it. No names: the owner is in the table cell next to the bar.
 */
export function ownerBarSvg(
  row: BoardOwnerRowDto,
  maxOwned: number,
  c: TileColours,
  width: number,
): string {
  const height = 12;
  const label = 34;
  const full = Math.max(0, width - label);
  const scale = maxOwned > 0 ? full / maxOwned : 0;
  const open = row.open * scale;
  const done = row.closedNow * scale;
  const parts = [
    open > 0 ? `<rect x="0" y="2" width="${n(open)}" height="8" fill="${c.accent}"/>` : "",
    done > 0 ? `<rect x="${n(open)}" y="2" width="${n(done)}" height="8" fill="${c.ok}"/>` : "",
    text(open + done + 3, 9, `${String(row.open)} + ${String(row.closedNow)}`, 7, c.textMuted),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${parts.join("")}</svg>`;
}
