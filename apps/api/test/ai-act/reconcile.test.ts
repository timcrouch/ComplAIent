import { describe, expect, it } from "vitest";
import { planReconciliation } from "../../src/ai-act/index.js";

describe("planReconciliation", () => {
  it("adds every applicable key to a system without rows", () => {
    expect(planReconciliation([], ["ai_literacy", "use_per_instructions"])).toEqual({
      added: ["ai_literacy", "use_per_instructions"],
      nowApplicable: [],
      nowInapplicable: [],
    });
  });

  it("flags rows that no longer apply and never removes them", () => {
    const stored = [
      { key: "ai_literacy", applicable: true },
      { key: "use_per_instructions", applicable: true },
    ];
    expect(planReconciliation(stored, ["ai_literacy"])).toEqual({
      added: [],
      nowApplicable: [],
      nowInapplicable: ["use_per_instructions"],
    });
  });

  it("brings back a flagged row instead of adding a second one", () => {
    const stored = [
      { key: "ai_literacy", applicable: true },
      { key: "use_per_instructions", applicable: false },
    ];
    expect(
      planReconciliation(stored, ["ai_literacy", "use_per_instructions", "inform_workers"]),
    ).toEqual({
      added: ["inform_workers"],
      nowApplicable: ["use_per_instructions"],
      nowInapplicable: [],
    });
  });

  it("reports keys in catalogue order, whatever order the rows come in", () => {
    const stored = [
      { key: "use_per_instructions", applicable: true },
      { key: "ai_literacy", applicable: true },
    ];
    expect(planReconciliation(stored, ["inform_workers"]).nowInapplicable).toEqual([
      "ai_literacy",
      "use_per_instructions",
    ]);
  });

  it("changes nothing when the stored rows already match", () => {
    const stored = [
      { key: "ai_literacy", applicable: true },
      { key: "inform_workers", applicable: false },
    ];
    expect(planReconciliation(stored, ["ai_literacy"])).toEqual({
      added: [],
      nowApplicable: [],
      nowInapplicable: [],
    });
  });
});
