import { describe, expect, it } from "vitest";
import { applicabilityHint, implementationStatus } from "../src/index.js";

describe("implementationStatus", () => {
  it("is notImplemented without accepted use", () => {
    expect(implementationStatus({ acceptedOnRisks: 0, latestResult: null })).toBe("notImplemented");
    expect(implementationStatus({ acceptedOnRisks: 0, latestResult: "effective" })).toBe(
      "notImplemented",
    );
  });
  it("is implementedNotTested when accepted with no test", () => {
    expect(implementationStatus({ acceptedOnRisks: 2, latestResult: null })).toBe(
      "implementedNotTested",
    );
  });
  it("is implementedTested for effective or partially effective", () => {
    expect(implementationStatus({ acceptedOnRisks: 1, latestResult: "effective" })).toBe(
      "implementedTested",
    );
    expect(implementationStatus({ acceptedOnRisks: 1, latestResult: "partially_effective" })).toBe(
      "implementedTested",
    );
  });
  it("is implementedIneffective when the latest test failed", () => {
    expect(implementationStatus({ acceptedOnRisks: 1, latestResult: "ineffective" })).toBe(
      "implementedIneffective",
    );
  });
});

describe("applicabilityHint", () => {
  it("lists the visible risk references when used", () => {
    expect(applicabilityHint({ visibleRefs: ["R-0001", "R-0004"], hiddenCount: 0 })).toEqual({
      kind: "used",
      refs: ["R-0001", "R-0004"],
      hiddenCount: 0,
    });
  });
  it("is used, with no references, when only risks the viewer cannot see use it (P7-R9)", () => {
    expect(applicabilityHint({ visibleRefs: [], hiddenCount: 2 })).toEqual({
      kind: "used",
      refs: [],
      hiddenCount: 2,
    });
  });
  it("is unused only when no risk anywhere uses it", () => {
    expect(applicabilityHint({ visibleRefs: [], hiddenCount: 0 })).toEqual({ kind: "unused" });
  });
});
