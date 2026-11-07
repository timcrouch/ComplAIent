import { describe, expect, it } from "vitest";
import {
  RISK_STATES,
  TREATMENTS,
  formatRiskReference,
  isEditable,
  mayConfirmReview,
  mayPlanActions,
  nextState,
  submitBlockers,
} from "../src/index.js";
import type { RiskAction, RiskState } from "../src/index.js";

describe("risk workflow", () => {
  it("exposes states and treatments", () => {
    expect(RISK_STATES).toEqual(["proposed", "in_review", "approved", "returned", "closed"]);
    expect(TREATMENTS).toEqual(["avoid", "mitigate", "transfer", "accept"]);
  });

  it("only proposed and returned are editable", () => {
    expect(RISK_STATES.filter(isEditable)).toEqual(["proposed", "returned"]);
  });

  it.each([
    ["proposed", "submit", "in_review"],
    ["returned", "submit", "in_review"],
    ["in_review", "approve", "approved"],
    ["in_review", "return", "returned"],
    ["approved", "submit", null],
    ["proposed", "approve", null],
    ["approved", "return", null],
    ["approved", "close", "closed"],
    ["proposed", "close", null],
    ["in_review", "close", null],
    ["returned", "close", null],
    ["closed", "close", null],
    ["approved", "reassess", "proposed"],
    ["closed", "reassess", "proposed"],
    ["proposed", "reassess", null],
    ["in_review", "reassess", null],
    ["returned", "reassess", null],
    ["closed", "submit", null],
    ["closed", "approve", null],
    ["closed", "return", null],
  ] as [RiskState, RiskAction, RiskState | null][])("%s --%s--> %s", (s, a, e) => {
    expect(nextState(s, a)).toBe(e);
  });

  it("lists blockers in order", () => {
    expect(
      submitBlockers({
        likelihood: null,
        impact: 3,
        treatment: null,
        ownerId: null,
        toConfirm: ["Which site?"],
      }),
    ).toEqual(["missingLikelihood", "missingTreatment", "missingOwner", "unresolvedToConfirm"]);
  });

  it("has no blockers when complete", () => {
    expect(
      submitBlockers({
        likelihood: 2,
        impact: 3,
        treatment: "avoid",
        ownerId: "u1",
        toConfirm: [],
      }),
    ).toEqual([]);
  });

  it("formats R-0001 and R-12345", () => {
    expect(formatRiskReference(1)).toBe("R-0001");
    expect(formatRiskReference(12345)).toBe("R-12345");
  });

  it("closed is not editable", () => {
    expect(isEditable("closed")).toBe(false);
  });

  it("mayConfirmReview only when approved or closed", () => {
    expect(RISK_STATES.filter(mayConfirmReview)).toEqual(["approved", "closed"]);
  });

  it.each([
    ["proposed", "mitigate", true],
    ["in_review", "avoid", true],
    ["approved", "transfer", true],
    ["returned", "mitigate", true],
    ["closed", "mitigate", false],
    ["approved", "accept", false],
    ["proposed", null, false],
  ] as [RiskState, "avoid" | "mitigate" | "transfer" | "accept" | null, boolean][])(
    "mayPlanActions(%s, %s) = %s",
    (s, t, e) => {
      expect(mayPlanActions(s, t)).toBe(e);
    },
  );
});
