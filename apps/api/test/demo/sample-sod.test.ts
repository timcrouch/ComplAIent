import { loadLibrary } from "@isms/control-library";
import { type LibraryIds, SAMPLE_APPETITE_THRESHOLD, planSampleYear, rowsFor } from "@isms/demo";
import type { Treatment } from "@isms/domain";
import { describe, expect, it } from "vitest";
import { PolicyService } from "../../src/authorization/index.js";
import { type Actor, toRoleAssignmentDto } from "../../src/identity/index.js";
import { type SodRisk, approvalRefusalFor, mayReturn } from "../../src/risks/approval-readiness.js";

/** Library ids for the shipped content, fake but stable: the decisions do not read them. */
function fakeLibrary(): LibraryIds {
  const lib = loadLibrary();
  let n = 0;
  const id = () => `00000000-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`;
  return {
    frameworkVersions: Object.fromEntries(lib.frameworks.map((f) => [f.version.key, id()])),
    controls: Object.fromEntries(lib.controls.map((c) => [c.code, id()])),
    requirements: Object.fromEntries(
      lib.frameworks.flatMap((f) => f.requirements.map((r) => [`${f.version.key} ${r.ref}`, id()])),
    ),
  };
}

const policy = new PolicyService();
const library = fakeLibrary();

// A normal weekday, the December holiday, and the first minute of a day.
describe.each(["2026-11-06T10:15:00.000Z", "2026-12-24T12:00:00.000Z", "2026-12-31T00:01:00.000Z"])(
  "separation of duties in the sample at %s (#8)",
  (iso) => {
    const now = new Date(iso);
    const rows = rowsFor(planSampleYear(now), {
      now,
      library,
      loader: null,
      bootstrapEmail: null,
    });

    /** The decider as ApprovalService sees them: the sample's role assignments, as stored. */
    const actorOf = (userId: string): Actor => ({
      userId,
      email: "",
      authTime: 0,
      authTimeSource: "auth_time",
      roles: rows.roleAssignments
        .filter((a) => a.userId === userId)
        .map((a) =>
          toRoleAssignmentDto({
            role: a.role,
            scopeType: a.scopeType,
            siteId: a.siteId ?? null,
            departmentId: a.departmentId ?? null,
          }),
        ),
    });

    /** The risk as it stood when it was decided: the snapshot the Approval row keeps. */
    const decided = (snapshot: unknown): SodRisk => {
      const s = snapshot as Record<string, unknown>;
      return {
        likelihood: s["likelihood"] as number | null,
        impact: s["impact"] as number | null,
        treatment: s["treatment"] as Treatment | null,
        reporterId: s["reporterId"] as string,
        reviewerId: s["reviewerId"] as string | null,
        siteId: s["siteId"] as string | null,
        departmentId: s["departmentId"] as string | null,
      };
    };

    it("has approvals and returns to check", () => {
      expect(rows.approvals.some((a) => a.decision === "approved")).toBe(true);
      expect(rows.approvals.some((a) => a.decision === "returned")).toBe(true);
    });

    it("every approval is one the API would allow: never the reporter, never a reviewer it forbids", () => {
      for (const a of rows.approvals.filter((x) => x.decision === "approved")) {
        const risk = decided(a.snapshot);
        expect(a.approverId, a.id).not.toBe(risk.reporterId);
        expect(
          approvalRefusalFor(policy, actorOf(a.approverId), risk, SAMPLE_APPETITE_THRESHOLD),
          `approval ${a.id}`,
        ).toBeNull();
      }
    });

    it("every return is by the reviewer or by someone who could approve", () => {
      for (const a of rows.approvals.filter((x) => x.decision === "returned")) {
        const risk = decided(a.snapshot);
        expect(
          mayReturn(policy, actorOf(a.approverId), risk, SAMPLE_APPETITE_THRESHOLD),
          `return ${a.id}`,
        ).toBe(true);
      }
    });
  },
);
