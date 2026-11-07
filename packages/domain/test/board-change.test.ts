import { describe, expect, it } from "vitest";
import {
  BOARD_TILES,
  changeLine,
  previousBoardPeriod,
  recentWeekStarts,
  weekStartsEnding,
} from "../src/index.js";

describe("previous board period", () => {
  it("is the month before a month", () => {
    expect(previousBoardPeriod({ key: "2026-10", start: "2026-10-01", end: "2026-10-31" })).toEqual(
      { key: "2026-09", start: "2026-09-01", end: "2026-09-30" },
    );
  });
  it("is the previous December for January", () => {
    expect(previousBoardPeriod({ key: "2027-01", start: "2027-01-01", end: "2027-01-31" })).toEqual(
      { key: "2026-12", start: "2026-12-01", end: "2026-12-31" },
    );
  });
  it("is the 30 days before the last 30 days", () => {
    expect(
      previousBoardPeriod({ key: "last-30-days", start: "2026-10-08", end: "2026-11-06" }),
    ).toEqual({ key: "prev-30-days", start: "2026-09-08", end: "2026-10-07" });
  });
});

describe("week starts ending", () => {
  it("ends with the week containing the end day", () => {
    const weeks = weekStartsEnding("2026-10-31", 12);
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)).toBe("2026-10-26");
    expect(weeks[0]).toBe("2026-08-10");
  });
  it("agrees with recentWeekStarts", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(recentWeekStarts(now, 12)).toEqual(weekStartsEnding("2026-11-06", 12));
  });
});

describe("change line", () => {
  it("is neutral unless judged", () => {
    expect(changeLine(5, 3, false)).toEqual({ delta: 2, direction: "up", tone: "neutral" });
    expect(changeLine(3, 5, false)).toEqual({ delta: 2, direction: "down", tone: "neutral" });
  });
  it("judges above appetite: down is better, up is worse, same is neutral", () => {
    expect(changeLine(2, 4, true)).toEqual({ delta: 2, direction: "down", tone: "better" });
    expect(changeLine(4, 2, true)).toEqual({ delta: 2, direction: "up", tone: "worse" });
    expect(changeLine(4, 4, true)).toEqual({ delta: 0, direction: "same", tone: "neutral" });
  });
});

describe("board tiles", () => {
  it("lists the seven tiles in the spec's order with fixed icons and tokens", () => {
    expect(BOARD_TILES.map((t) => t.key)).toEqual([
      "openRisks",
      "aboveAppetite",
      "reported",
      "approved",
      "closed",
      "overdueActions",
      "reviewsDue",
    ]);
    expect(BOARD_TILES.map((t) => [t.icon, t.token])).toEqual([
      ["CircleDot", "accent"],
      ["TriangleAlert", "critical"],
      ["FilePlus2", "chartBlue"],
      ["BadgeCheck", "chartTeal"],
      ["ShieldCheck", "ok"],
      ["AlarmClock", "attention"],
      ["CalendarClock", "textMuted"],
    ]);
  });
});
