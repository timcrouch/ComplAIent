import { describe, expect, it } from "vitest";
import {
  ConflictReasonSchema,
  GrantRoleRequest,
  ScopeInput,
  conflictDetail,
  conflictReasons,
} from "../src/index.js";

describe("conflict reasons (P2-R8)", () => {
  it("has exactly the reasons the API can give", () => {
    expect(ConflictReasonSchema.options).toEqual([
      "lastAdministrator",
      "duplicateRoleAssignment",
      "siteInUse",
      "departmentInUse",
      "setupIncomplete",
      "staleVersion",
      "riskNotEditable",
      "invalidTransition",
      "submitBlocked",
      "approvalRefused",
      "aiUnavailable",
      "conversationClosed",
      "evidenceHashMismatch",
      "controlNotAccepted",
      "controlHasOpenRequest",
      "duplicateRiskControl",
      "taskClosed",
      "openTreatmentActions",
      "treatmentIsAccept",
      "riskClosed",
      "taskNotAssignee",
      "secretsKeyMissing",
      "keyUnreadable",
      "reportTooLarge",
      "narrativeUnverifiable",
      "confirmationMismatch",
      "duplicateAiSystemName",
      "duplicateAiSystemRisk",
    ]);
  });

  it("builds the path from the reason and an optional item", () => {
    expect(conflictDetail("lastAdministrator").path).toBe("lastAdministrator");
    expect(conflictDetail("siteInUse", "Riga plant", "In use")).toEqual({
      path: "siteInUse.Riga plant",
      message: "In use",
    });
    expect(conflictDetail("setupIncomplete").message).toEqual(expect.any(String));
  });

  it("round-trips reasons and items and ignores unknown paths", () => {
    const details = [
      conflictDetail("lastAdministrator"),
      conflictDetail("departmentInUse", "d-1"),
      conflictDetail("siteInUse", "a.b"),
      { path: "somethingElse", message: "x" },
      { path: "somethingElse.item", message: "x" },
      { path: "", message: "x" },
      { path: "constructor", message: "x" },
    ];
    expect(conflictReasons(details)).toEqual([
      { reason: "lastAdministrator", item: null },
      { reason: "departmentInUse", item: "d-1" },
      { reason: "siteInUse", item: "a.b" },
    ]);
  });
});

describe("role grant input", () => {
  const id = "0190a4b8-6f1e-7c3a-9b2d-4e5f6a7b8c9d";

  it("accepts organisation scope only with a null id, and units only with a uuid", () => {
    expect(ScopeInput.safeParse({ type: "organisation", id: null }).success).toBe(true);
    expect(ScopeInput.safeParse({ type: "site", id }).success).toBe(true);
    expect(ScopeInput.safeParse({ type: "department", id }).success).toBe(true);
    expect(ScopeInput.safeParse({ type: "organisation", id }).success).toBe(false);
    expect(ScopeInput.safeParse({ type: "site", id: null }).success).toBe(false);
    expect(ScopeInput.safeParse({ type: "site", id: "A" }).success).toBe(false);
    expect(ScopeInput.safeParse({ type: "galaxy", id: null }).success).toBe(false);
  });

  it("requires a known role and rejects extra fields", () => {
    const scope = { type: "organisation", id: null };
    expect(GrantRoleRequest.safeParse({ role: "ciso", scope }).success).toBe(true);
    expect(GrantRoleRequest.safeParse({ role: "root", scope }).success).toBe(false);
    expect(GrantRoleRequest.safeParse({ role: "ciso", scope, grantedById: id }).success).toBe(
      false,
    );
  });
});
