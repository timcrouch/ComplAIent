import type { SetupStep } from "@isms/contracts";
import { describe, expect, it } from "vitest";
import { firstIncompleteStep, SETUP_STEPS } from "../components/setup/steps";

describe("SETUP_STEPS", () => {
  it("lists the six steps in order with their paths and API steps", () => {
    expect(SETUP_STEPS.map((s) => [s.key, s.path, s.apiStep])).toEqual([
      ["organisation", "/setup/organisation", "profile"],
      ["sites", "/setup/sites", "sites"],
      ["frameworks", "/setup/frameworks", "frameworks"],
      ["riskAppetite", "/setup/risk-appetite", "riskScale"],
      ["people", "/setup/people", null],
      ["review", "/setup/review", null],
    ]);
  });
});

describe("firstIncompleteStep", () => {
  it.each([
    [["profile", "sites", "frameworks", "riskScale"], "organisation"],
    [["sites", "frameworks"], "sites"],
    [["frameworks", "riskScale"], "frameworks"],
    [["riskScale"], "riskAppetite"],
    [[], "review"],
  ] as [SetupStep[], string][])("firstIncompleteStep(%j) is %s", (missing, key) => {
    expect(firstIncompleteStep(missing).key).toBe(key);
  });
});
