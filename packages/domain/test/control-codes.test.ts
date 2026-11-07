import { describe, expect, it } from "vitest";
import {
  CONTROL_CATEGORIES,
  CONTROL_CODE_PATTERN,
  CONTROL_CODE_PREFIX_CATEGORY,
  controlCategoryForCode,
} from "../src/control-codes.js";

describe("control codes", () => {
  it("has one prefix per category", () => {
    expect(Object.values(CONTROL_CODE_PREFIX_CATEGORY).sort()).toEqual(
      [...CONTROL_CATEGORIES].sort(),
    );
  });
  it("accepts well-formed codes only", () => {
    expect(CONTROL_CODE_PATTERN.test("GOV-01")).toBe(true);
    expect(CONTROL_CODE_PATTERN.test("DEV-12")).toBe(true);
    for (const bad of ["XXX-01", "GOV-1", "GOV-001", "gov-01", " GOV-01", "GOV-01 "]) {
      expect(CONTROL_CODE_PATTERN.test(bad)).toBe(false);
    }
  });
  it("maps a code to its category", () => {
    expect(controlCategoryForCode("RES-01")).toBe("resilience");
    expect(controlCategoryForCode("nope")).toBeUndefined();
  });
});
