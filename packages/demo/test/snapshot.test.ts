import { describe, expect, it } from "vitest";
import { type RiskRow, versionSnapshot } from "../src/index.js";

const risk: RiskRow = {
  id: "0190a000-0000-7000-8000-000000000001",
  reference: 7,
  version: 3,
  title: "T",
  scenario: "S",
  threat: "Th",
  consequence: "C",
  existingSafeguards: "",
  toConfirm: ["a"],
  likelihood: 3,
  impact: 4,
  residualLikelihood: 2,
  residualImpact: 2,
  riskScaleId: "0190a000-0000-7000-8000-000000000002",
  aiLikelihood: null,
  aiImpact: null,
  aiReasoning: null,
  treatment: "mitigate",
  treatmentNote: "n",
  state: "closed",
  ownerId: "0190a000-0000-7000-8000-000000000003",
  reporterId: "0190a000-0000-7000-8000-000000000004",
  reviewerId: null,
  submittedAt: null,
  approvedAt: null,
  siteId: null,
  departmentId: null,
  aiAssisted: false,
  closedAt: new Date("2026-05-06T07:08:09.010Z"),
  closedById: "0190a000-0000-7000-8000-000000000003",
  nextReviewDue: new Date("2027-05-06T00:00:00.000Z"),
  controlSuggestion: "none",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-05-06T07:08:09.010Z"),
};

describe("versionSnapshot", () => {
  it("formats the reference, dates and sorted relations like writeVersion", () => {
    const s = versionSnapshot(
      risk,
      [
        { name: "b", type: "service" },
        { name: "a", type: "device" },
        { name: "a", type: "application" },
      ],
      ["OPS-02", "ACC-01"],
    );
    expect(s["reference"]).toBe("R-0007");
    expect(s["closedAt"]).toBe("2026-05-06T07:08:09.010Z");
    expect(s["nextReviewDue"]).toBe("2027-05-06");
    expect(s["assets"]).toEqual([
      { name: "a", type: "application" },
      { name: "a", type: "device" },
      { name: "b", type: "service" },
    ]);
    expect(s["controls"]).toEqual(["ACC-01", "OPS-02"]);
    expect("lifecycleNote" in s).toBe(false);
    expect(versionSnapshot(risk, [], [], "why")["lifecycleNote"]).toBe("why");
  });
});
