import { describe, expect, it } from "vitest";
import { formatDate } from "../lib/dates";

describe("formatDate", () => {
  it("writes the day, the month in words and the year, British style", () => {
    expect(formatDate("2026-11-05T09:00:00.000Z", "UTC")).toBe("5 November 2026");
  });

  it("uses the viewer's time zone for the calendar day", () => {
    expect(formatDate("2026-11-04T22:30:00.000Z", "Europe/Riga")).toBe("5 November 2026");
  });
});
