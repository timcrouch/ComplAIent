import { describe, expect, it } from "vitest";
import { recentWeekStarts, weekStartUtc } from "../src/index.js";

describe("weeks", () => {
  it("maps Sunday to the previous Monday", () => {
    expect(weekStartUtc(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-02");
  });
  it("keeps a Monday midnight", () => {
    expect(weekStartUtc(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
  });
  it("lists recent weeks oldest first", () => {
    expect(recentWeekStarts(new Date("2026-11-06T12:00:00Z"), 3)).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
  });
});
