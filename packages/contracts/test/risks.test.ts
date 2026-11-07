import { describe, expect, it } from "vitest";
import { ReportRiskInput, RiskEditInput, RiskListQuery } from "../src/index.js";

const report = {
  title: "Laptop left on the train",
  scenario: "A laptop was left on a train.\nIt held customer files.",
  threat: "Loss of a device",
  consequence: "Customer data exposed",
  existingSafeguards: "",
  assets: [{ name: "Staff laptops", type: "device" }],
  siteId: null,
  departmentId: null,
  toConfirm: [],
};

describe("risk contracts", () => {
  it("accepts a complete report with empty safeguards and refuses unknown fields", () => {
    expect(ReportRiskInput.parse({ ...report, existingSafeguards: "   " }).existingSafeguards).toBe(
      "",
    );
    expect(ReportRiskInput.safeParse({ ...report, aiAssisted: true }).success).toBe(false);
    expect(ReportRiskInput.safeParse({ ...report, title: "a\u0000b" }).success).toBe(false);
    expect(ReportRiskInput.safeParse({ ...report, title: "  " }).success).toBe(false);
    expect(
      ReportRiskInput.safeParse({ ...report, assets: [{ name: "a\tb", type: "device" }] }).success,
    ).toBe(false);
  });

  it("needs at least one change and levels of 1-5 or null", () => {
    expect(RiskEditInput.safeParse({ expectedVersion: 1, changes: {} }).success).toBe(false);
    expect(
      RiskEditInput.safeParse({ expectedVersion: 0, changes: { likelihood: 2 } }).success,
    ).toBe(false);
    expect(RiskEditInput.safeParse({ expectedVersion: 1, changes: { impact: 6 } }).success).toBe(
      false,
    );
    expect(RiskEditInput.parse({ expectedVersion: 2, changes: { impact: null } })).toEqual({
      expectedVersion: 2,
      changes: { impact: null },
    });
    expect(
      RiskEditInput.safeParse({ expectedVersion: 1, changes: { state: "approved" } }).success,
    ).toBe(false);
  });

  it("accepts residual levels of 1-5 or null in an edit", () => {
    expect(
      RiskEditInput.parse({
        expectedVersion: 1,
        changes: { residualLikelihood: 2, residualImpact: null },
      }).changes,
    ).toEqual({ residualLikelihood: 2, residualImpact: null });
    expect(
      RiskEditInput.safeParse({ expectedVersion: 1, changes: { residualImpact: 0 } }).success,
    ).toBe(false);
  });

  it("defaults the list query and coerces the limit from the query string", () => {
    expect(RiskListQuery.parse({})).toEqual({
      filter: "all",
      limit: 50,
      basis: "inherent",
      includeClosed: false,
    });
    expect(RiskListQuery.parse({ includeClosed: "true" }).includeClosed).toBe(true);
    expect(RiskListQuery.parse({ includeClosed: "false" }).includeClosed).toBe(false);
    expect(RiskListQuery.safeParse({ includeClosed: "yes" }).success).toBe(false);
    expect(RiskListQuery.parse({ limit: "10", filter: "toReview" })).toEqual({
      filter: "toReview",
      limit: 10,
      basis: "inherent",
      includeClosed: false,
    });
    expect(RiskListQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(RiskListQuery.safeParse({ filter: "mine" }).success).toBe(false);
  });
});

describe("RiskListQuery cell filter", () => {
  it("takes both of likelihood and impact or neither", () => {
    expect(RiskListQuery.safeParse({ likelihood: "4" }).success).toBe(false);
    expect(RiskListQuery.safeParse({ impact: "4" }).success).toBe(false);
    expect(RiskListQuery.safeParse({ likelihood: "6", impact: "1" }).success).toBe(false);
    const ok = RiskListQuery.parse({ likelihood: "4", impact: "2" });
    expect(ok).toMatchObject({ likelihood: 4, impact: 2, basis: "inherent" });
    expect(RiskListQuery.parse({}).basis).toBe("inherent");
  });
});
