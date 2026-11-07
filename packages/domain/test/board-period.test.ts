import { describe, expect, it } from "vitest";
import { boardPeriodByKey, boardPeriods, defaultBoardPeriod } from "../src/index.js";

const now = new Date("2026-11-06T09:30:00Z");

describe("board periods", () => {
  it("lists last-30-days then six full months, newest first", () => {
    const periods = boardPeriods(now);
    expect(periods).toHaveLength(7);
    expect(periods[0]).toEqual({ key: "last-30-days", start: "2026-10-08", end: "2026-11-06" });
    expect(periods[1]).toEqual({ key: "2026-10", start: "2026-10-01", end: "2026-10-31" });
    expect(periods.map((p) => p.key).slice(1)).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
    ]);
    expect(periods[2]).toEqual({ key: "2026-09", start: "2026-09-01", end: "2026-09-30" });
  });
  it("crosses year boundaries and handles leap February", () => {
    const periods = boardPeriods(new Date("2028-03-15T00:00:00Z"));
    expect(periods[1]).toEqual({ key: "2028-02", start: "2028-02-01", end: "2028-02-29" });
    expect(periods[3]).toEqual({ key: "2027-12", start: "2027-12-01", end: "2027-12-31" });
  });
  it("defaults to the last full calendar month", () => {
    expect(defaultBoardPeriod(now).key).toBe("2026-10");
  });
  it("finds a period by key or returns null", () => {
    expect(boardPeriodByKey(now, "2026-08")?.end).toBe("2026-08-31");
    expect(boardPeriodByKey(now, "last-30-days")?.start).toBe("2026-10-08");
    expect(boardPeriodByKey(now, "2026-11")).toBeNull();
    expect(boardPeriodByKey(now, "nonsense")).toBeNull();
  });
});
