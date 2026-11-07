import { describe, expect, it } from "vitest";
import { dayPeriod, firstName, resolveTimeZone } from "../lib/greeting";
import { parseTheme, themeAttribute } from "../lib/theme";

describe("dayPeriod", () => {
  const at = (iso: string) => new Date(iso);

  it("uses the hour in the given time zone", () => {
    // 09:30 UTC is 11:30 in Riga (UTC+2 in November) and 04:30 in New York.
    expect(dayPeriod(at("2026-11-03T09:30:00Z"), "Europe/Riga")).toBe("morning");
    expect(dayPeriod(at("2026-11-03T10:30:00Z"), "Europe/Riga")).toBe("afternoon");
    expect(dayPeriod(at("2026-11-03T16:00:00Z"), "Europe/Riga")).toBe("evening");
    expect(dayPeriod(at("2026-11-03T16:00:00Z"), "America/New_York")).toBe("morning");
  });

  it("treats midnight to 04:59 as evening and 05:00 as morning", () => {
    expect(dayPeriod(at("2026-11-03T00:00:00Z"), "UTC")).toBe("evening");
    expect(dayPeriod(at("2026-11-03T04:59:00Z"), "UTC")).toBe("evening");
    expect(dayPeriod(at("2026-11-03T05:00:00Z"), "UTC")).toBe("morning");
    expect(dayPeriod(at("2026-11-03T11:59:00Z"), "UTC")).toBe("morning");
    expect(dayPeriod(at("2026-11-03T12:00:00Z"), "UTC")).toBe("afternoon");
    expect(dayPeriod(at("2026-11-03T17:59:00Z"), "UTC")).toBe("afternoon");
    expect(dayPeriod(at("2026-11-03T18:00:00Z"), "UTC")).toBe("evening");
  });
});

describe("resolveTimeZone", () => {
  it("accepts a valid IANA zone, percent-encoded or not", () => {
    expect(resolveTimeZone("Europe/Riga")).toBe("Europe/Riga");
    expect(resolveTimeZone("America%2FNew_York")).toBe("America/New_York");
  });

  it("falls back to UTC for missing, unknown, malformed or oversized values", () => {
    for (const value of [undefined, "", "Mars/Olympus", "%E0%A4%A", "<script>", "A".repeat(80)]) {
      expect(resolveTimeZone(value)).toBe("UTC");
    }
  });
});

describe("firstName", () => {
  it("takes the first word of the display name", () => {
    expect(firstName("Anna Admin")).toBe("Anna");
    expect(firstName("  Rita  ")).toBe("Rita");
  });

  it("is empty when there is no display name", () => {
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("");
  });
});

describe("theme", () => {
  it("parses the cookie, defaulting to system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("purple")).toBe("system");
  });

  it("maps a theme to the data-theme attribute (none for system)", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });
});
