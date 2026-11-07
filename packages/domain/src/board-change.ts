export type ChangeTone = "neutral" | "worse" | "better";
export type Change = { delta: number; direction: "up" | "down" | "same"; tone: ChangeTone };

/**
 * The change from `before` to `now`: the size and direction. Arrows do not judge (spec §4.2),
 * so the tone is "neutral" unless `judged` (above appetite only): more is "worse", fewer "better".
 */
export function changeLine(now: number, before: number, judged: boolean): Change {
  const direction = now > before ? "up" : now < before ? "down" : "same";
  const tone: ChangeTone =
    !judged || direction === "same" ? "neutral" : direction === "up" ? "worse" : "better";
  return { delta: Math.abs(now - before), direction, tone };
}

export type BoardTileKey =
  | "openRisks"
  | "aboveAppetite"
  | "reported"
  | "approved"
  | "closed"
  | "overdueActions"
  | "reviewsDue";

/** A design-token key of `@isms/ui` (the domain does not depend on the UI package). */
export type TileToken =
  "accent" | "critical" | "chartBlue" | "chartTeal" | "ok" | "attention" | "textMuted";

export type BoardTile = {
  key: BoardTileKey;
  /** The lucide component name; the PDF draws the same glyph. */
  icon:
    | "CircleDot"
    | "TriangleAlert"
    | "FilePlus2"
    | "BadgeCheck"
    | "ShieldCheck"
    | "AlarmClock"
    | "CalendarClock";
  token: TileToken;
};

/** The board pack's status tiles in display order (spec §4.1): one mapping for screen and PDF. */
export const BOARD_TILES: readonly BoardTile[] = [
  { key: "openRisks", icon: "CircleDot", token: "accent" },
  { key: "aboveAppetite", icon: "TriangleAlert", token: "critical" },
  { key: "reported", icon: "FilePlus2", token: "chartBlue" },
  { key: "approved", icon: "BadgeCheck", token: "chartTeal" },
  { key: "closed", icon: "ShieldCheck", token: "ok" },
  { key: "overdueActions", icon: "AlarmClock", token: "attention" },
  { key: "reviewsDue", icon: "CalendarClock", token: "textMuted" },
];
