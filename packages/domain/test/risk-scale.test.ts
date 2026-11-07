import { describe, expect, it } from "vitest";
import {
  APPETITE_PRESETS,
  DEFAULT_APPETITE_THRESHOLD,
  MAX_APPETITE_THRESHOLD,
  MIN_APPETITE_THRESHOLD,
  isAboveAppetite,
  riskScore,
} from "../src/index.js";

describe("risk scale", () => {
  it("score is likelihood × impact; above appetite only when score > threshold", () => {
    expect(riskScore(3, 3)).toBe(9);
    expect(riskScore(2, 5)).toBe(10);
    expect(isAboveAppetite(riskScore(3, 3), 9)).toBe(false);
    expect(isAboveAppetite(riskScore(2, 5), 9)).toBe(true);
    expect(riskScore(5, 5)).toBe(25);
    expect(isAboveAppetite(25, MAX_APPETITE_THRESHOLD)).toBe(true);
    expect(isAboveAppetite(1, MIN_APPETITE_THRESHOLD)).toBe(false);
  });

  it("presets are cautious 4, balanced 9 (default), bold 14", () => {
    expect(APPETITE_PRESETS).toEqual({ cautious: 4, balanced: 9, bold: 14 });
    expect(DEFAULT_APPETITE_THRESHOLD).toBe(APPETITE_PRESETS.balanced);
    expect([MIN_APPETITE_THRESHOLD, MAX_APPETITE_THRESHOLD]).toEqual([1, 24]);
  });
});
