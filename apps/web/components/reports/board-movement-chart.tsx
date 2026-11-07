import type { BoardMovementWeekDto } from "@isms/contracts";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { TILE_ICON, dayMonth } from "./board-icons";

const W = 640;
const H = 220;
const LEFT = 30;
const BOTTOM = 24;
const FONT = 11;
/** A tick label's baseline sits this far below its tick, which centres it on the line. */
const TICK_DY = 4;
/** Baseline of the right axis title: one font height, so its glyphs stay inside the chart. */
const TITLE_Y = FONT;
/**
 * Space above the plot. With the line on its own axis, the title's baseline and height sit a font
 * height clear of the top tick's baseline (title + font <= tick - font), as in the PDF (#16).
 * The viewBox scales as a whole, so this holds at phone width too.
 */
const topFor = (own: boolean) => (own ? TITLE_Y + 2 * FONT - TICK_DY : 12);

const SERIES = [
  { key: "reported", icon: "FilePlus2", text: "text-chart-blue" },
  { key: "approved", icon: "BadgeCheck", text: "text-chart-teal" },
  { key: "closed", icon: "ShieldCheck", text: "text-ok" },
] as const;

/**
 * 12 weekly groups of three bars (reported, approved, treated) and a line of risks open at each
 * week's end, with the same scale rules as the PDF: the line gets its own labelled right-hand
 * axis, with a title above it and a mid tick, when open risks exceed 3 times the tallest bar
 * (P8-R4); an axis maximum is never below 1.
 * The numbers are in a table behind "Show as table".
 */
export function BoardMovementChart({ weeks }: { weeks: BoardMovementWeekDto[] }) {
  const t = useTranslations("reports.board.movement");
  const summaryId = useId();
  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.reported, w.approved, w.closed)));
  const maxOpen = Math.max(1, ...weeks.map((w) => w.openAtEnd));
  const own = maxOpen > 3 * maxBar;
  const leftMax = own ? maxBar : Math.max(maxBar, maxOpen);
  const rightMax = own ? maxOpen : leftMax;

  const right = own ? 34 : 8;
  const top = topFor(own);
  const pw = W - LEFT - right;
  const ph = H - top - BOTTOM;
  const gw = pw / Math.max(1, weeks.length);
  const bw = Math.min(10, gw * 0.24);
  const y = (v: number, max: number) => top + ph - (v / max) * ph;
  const ticks = leftMax >= 2 ? [0, leftMax / 2, leftMax] : [0, leftMax];
  // The line's own axis exceeds 3, so it always has a whole-number middle.
  const rightTicks = [0, Math.round(rightMax / 2), rightMax];
  const fmt = (v: number) => String(Math.round(v * 10) / 10);
  const sum = (key: "reported" | "approved" | "closed") => weeks.reduce((s, w) => s + w[key], 0);
  const points = weeks.map((w, i) => ({
    x: LEFT + i * gw + gw / 2,
    y: y(w.openAtEnd, rightMax),
  }));
  const OpenIcon = TILE_ICON.CircleDot;

  return (
    <div className="flex flex-col gap-3">
      <p id={summaryId} className="sr-only">
        {t("summary", {
          weeks: weeks.length,
          reported: sum("reported"),
          approved: sum("approved"),
          treated: sum("closed"),
          open: weeks.at(-1)?.openAtEnd ?? 0,
        })}
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted">
        {SERIES.map((s) => {
          const Icon = TILE_ICON[s.icon];
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <Icon aria-hidden className={`size-4 ${s.text}`} />
              {t(`legend.${s.key}`)}
            </li>
          );
        })}
        <li className="flex items-center gap-1.5">
          <OpenIcon aria-hidden className="size-4 text-accent" />
          {t("legend.openAtEnd")}
        </li>
      </ul>
      <svg
        role="img"
        aria-labelledby={summaryId}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="h-auto w-full"
        fontSize={FONT}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={LEFT}
              x2={W - right}
              y1={y(tick, leftMax)}
              y2={y(tick, leftMax)}
              className="stroke-surface-border"
              strokeWidth={1}
            />
            <text
              x={LEFT - 4}
              y={y(tick, leftMax) + TICK_DY}
              textAnchor="end"
              className="fill-fg-muted"
            >
              {fmt(tick)}
            </text>
          </g>
        ))}
        {own ? (
          <g className="fill-accent">
            <text x={W - 2} y={TITLE_Y} textAnchor="end">
              {t("openAxis")}
            </text>
            {rightTicks.map((v) => (
              <text key={v} x={W - right + 4} y={y(v, rightMax) + TICK_DY}>
                {v}
              </text>
            ))}
          </g>
        ) : null}
        {weeks.map((w, i) => {
          const gx = LEFT + i * gw + gw / 2 - (bw * 3) / 2;
          return (
            <g key={w.weekStart}>
              {SERIES.map((s, j) => {
                const h = (w[s.key] / leftMax) * ph;
                return h > 0 ? (
                  <rect
                    key={s.key}
                    x={gx + j * bw}
                    y={top + ph - h}
                    width={bw - 1}
                    height={h}
                    fill="currentColor"
                    className={s.text}
                  />
                ) : null;
              })}
              <text
                x={LEFT + i * gw + gw / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                className="fill-fg-muted"
              >
                {dayMonth(w.weekStart)}
              </text>
            </g>
          );
        })}
        {points.length > 0 ? (
          <g className="text-accent">
            <polyline
              points={points.map((p) => `${String(p.x)},${String(p.y)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
            {points.map((p) => (
              <circle key={p.x} cx={p.x} cy={p.y} r={3} fill="currentColor" />
            ))}
          </g>
        ) : null}
      </svg>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer font-semibold text-accent">
          {t("showTable")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px] text-fg">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-semibold text-fg-muted">
                  {t("week")}
                </th>
                {weeks.map((w) => (
                  <th
                    key={w.weekStart}
                    scope="col"
                    className="px-2 py-1 text-right font-semibold text-fg-muted"
                  >
                    {dayMonth(w.weekStart)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["reported", "approved", "closed", "openAtEnd"] as const).map((key) => (
                <tr key={key} className="border-t border-surface-border/60">
                  <th scope="row" className="px-2 py-1 text-left font-semibold">
                    {t(`legend.${key}`)}
                  </th>
                  {weeks.map((w) => (
                    <td key={w.weekStart} className="px-2 py-1 text-right tabular-nums">
                      {w[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
