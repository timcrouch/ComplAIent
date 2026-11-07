import type { BoardTile, TileToken } from "@isms/domain";
import {
  AlarmClockIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  CircleDotIcon,
  FilePlus2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

/** The lucide component for each `BOARD_TILES` icon name: the PDF draws the same glyphs. */
export const TILE_ICON: Record<BoardTile["icon"], LucideIcon> = {
  CircleDot: CircleDotIcon,
  TriangleAlert: TriangleAlertIcon,
  FilePlus2: FilePlus2Icon,
  BadgeCheck: BadgeCheckIcon,
  ShieldCheck: ShieldCheckIcon,
  AlarmClock: AlarmClockIcon,
  CalendarClock: CalendarClockIcon,
};

/** Text colour classes by tile token (Tailwind needs the full class names written out). */
export const TOKEN_TEXT: Record<TileToken, string> = {
  accent: "text-accent",
  critical: "text-critical",
  chartBlue: "text-chart-blue",
  chartTeal: "text-chart-teal",
  ok: "text-ok",
  attention: "text-attention",
  textMuted: "text-fg-muted",
};

const dayMonthFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});

/** "1 Oct" from "2026-10-01", without any timezone drift (the date is read as UTC midnight). */
export const dayMonth = (iso: string): string => {
  const parts = dayMonthFormat.formatToParts(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}`;
};

/** "Sep" from a month key such as "2026-09". */
export const shortMonth = (key: string): string =>
  monthFormat.format(new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`));
