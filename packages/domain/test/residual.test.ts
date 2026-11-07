import { describe, expect, it } from "vitest";
import { mapPosition, residualProblems } from "../src/index.js";

const base = {
  likelihood: 4,
  impact: 4,
  residualLikelihood: null,
  residualImpact: null,
  treatment: "mitigate" as const,
};

describe("residualProblems", () => {
  it("flags residual above inherent", () => {
    expect(residualProblems({ ...base, residualLikelihood: 5, residualImpact: 2 })).toEqual([
      "residualAboveInherent",
    ]);
  });
  it("flags when inherent was lowered below residual", () => {
    expect(
      residualProblems({
        ...base,
        likelihood: 2,
        residualLikelihood: 3,
        residualImpact: 1,
      }),
    ).toEqual(["residualAboveInherent"]);
  });
  it("flags residual set while inherent is null, once", () => {
    expect(
      residualProblems({
        ...base,
        likelihood: null,
        residualLikelihood: 1,
        residualImpact: null,
      }),
    ).toEqual(["residualAboveInherent"]);
    expect(
      residualProblems({
        ...base,
        likelihood: null,
        impact: null,
        residualLikelihood: 1,
        residualImpact: 1,
      }),
    ).toEqual(["residualAboveInherent"]);
  });
  it("flags residual for accept", () => {
    expect(
      residualProblems({
        ...base,
        treatment: "accept",
        residualLikelihood: 1,
        residualImpact: 1,
      }),
    ).toEqual(["residualForAccept"]);
  });
  it("allows nulls and valid values", () => {
    expect(residualProblems({ ...base, treatment: "accept" })).toEqual([]);
    expect(residualProblems(base)).toEqual([]);
    expect(residualProblems({ ...base, residualLikelihood: 4, residualImpact: 1 })).toEqual([]);
  });
});

describe("mapPosition", () => {
  it("inherent needs both fields", () => {
    expect(mapPosition(base, "inherent")).toEqual({ likelihood: 4, impact: 4 });
    expect(mapPosition({ ...base, impact: null }, "inherent")).toBeNull();
  });
  it("residual needs both residual fields", () => {
    expect(mapPosition({ ...base, residualLikelihood: 2, residualImpact: 3 }, "residual")).toEqual({
      likelihood: 2,
      impact: 3,
    });
    expect(mapPosition({ ...base, residualLikelihood: 2 }, "residual")).toBeNull();
  });
  it("accept uses inherent position in residual basis", () => {
    expect(mapPosition({ ...base, treatment: "accept" }, "residual")).toEqual({
      likelihood: 4,
      impact: 4,
    });
    expect(mapPosition({ ...base, treatment: "accept", likelihood: null }, "residual")).toBeNull();
  });
});
