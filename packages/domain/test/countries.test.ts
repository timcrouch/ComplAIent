import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, isCountryCode } from "../src/index.js";

describe("ISO 3166-1 alpha-2 country codes", () => {
  it("has 249 unique two-letter codes including LV, DE, PL, US and excludes UK", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRY_CODES);
    for (const code of ["LV", "DE", "PL", "US", "GB", "AQ", "AX"]) {
      expect(isCountryCode(code)).toBe(true);
    }
    for (const code of ["UK", "EU", "XK", "XX", "lv", "LVA", "", "__proto__"]) {
      expect(isCountryCode(code)).toBe(false);
    }
  });
});
