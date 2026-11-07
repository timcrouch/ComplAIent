import type { RoleAssignmentDto } from "@isms/contracts";
import { describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { riskVisibilityWhere } from "../../src/risks/risk-visibility.js";

type SampleRisk = {
  id: string;
  state: "proposed" | "in_review" | "approved" | "returned" | "closed";
  reporterId: string;
  ownerId: string | null;
  siteId: string | null;
  departmentId: string | null;
};

/**
 * A tiny evaluator for the subset of Prisma's where syntax the visibility rules may use:
 * AND, OR, NOT, plain equality and `{ in: [...] }` / `{ equals }` on scalar fields.
 */
function matches(where: unknown, risk: SampleRisk): boolean {
  if (where === undefined) return true;
  if (typeof where !== "object" || where === null) throw new Error("bad where");
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as unknown[]).every((w) => matches(w, risk));
    if (key === "OR") return (cond as unknown[]).some((w) => matches(w, risk));
    if (key === "NOT") return !matches(cond, risk);
    if (!(key in risk)) throw new Error(`unsupported field ${key}`);
    const value = risk[key as keyof SampleRisk];
    if (cond === null || typeof cond !== "object") return value === cond;
    const c = cond as { in?: unknown[]; equals?: unknown };
    if (c.in) return c.in.includes(value);
    if ("equals" in c) return value === c.equals;
    throw new Error(`unsupported condition on ${key}`);
  });
}

const ME = "user-me";
const OTHER = "user-other";
const SITE_A = "site-a";
const SITE_B = "site-b";
const DEPT_X = "dept-x";

const RISKS: SampleRisk[] = [
  {
    id: "mine",
    state: "proposed",
    reporterId: ME,
    ownerId: null,
    siteId: SITE_B,
    departmentId: null,
  },
  {
    id: "owned",
    state: "proposed",
    reporterId: OTHER,
    ownerId: ME,
    siteId: SITE_B,
    departmentId: null,
  },
  {
    id: "a-proposed",
    state: "proposed",
    reporterId: OTHER,
    ownerId: null,
    siteId: SITE_A,
    departmentId: null,
  },
  {
    id: "a-approved",
    state: "approved",
    reporterId: OTHER,
    ownerId: null,
    siteId: SITE_A,
    departmentId: null,
  },
  {
    id: "a-closed",
    state: "closed",
    reporterId: OTHER,
    ownerId: null,
    siteId: SITE_A,
    departmentId: null,
  },
  {
    id: "b-proposed",
    state: "proposed",
    reporterId: OTHER,
    ownerId: null,
    siteId: SITE_B,
    departmentId: null,
  },
  {
    id: "b-approved",
    state: "approved",
    reporterId: OTHER,
    ownerId: null,
    siteId: SITE_B,
    departmentId: DEPT_X,
  },
  {
    id: "none-review",
    state: "in_review",
    reporterId: OTHER,
    ownerId: null,
    siteId: null,
    departmentId: null,
  },
];

const org = (role: RoleAssignmentDto["role"]): RoleAssignmentDto => ({
  role,
  scope: { type: "organisation", id: null },
});
const site = (role: RoleAssignmentDto["role"], id: string): RoleAssignmentDto => ({
  role,
  scope: { type: "site", id },
});
const dept = (role: RoleAssignmentDto["role"], id: string): RoleAssignmentDto => ({
  role,
  scope: { type: "department", id },
});

const visibleTo = (roles: RoleAssignmentDto[]): string[] => {
  const actor: Actor = {
    userId: ME,
    email: "me@example.test",
    authTime: 0,
    authTimeSource: "auth_time",
    roles,
  };
  const where = riskVisibilityWhere(actor);
  return RISKS.filter((r) => matches(where, r)).map((r) => r.id);
};

describe("riskVisibilityWhere (§10)", () => {
  it("a contributor sees only risks they reported", () => {
    // ...and those they own: ownership always grants sight.
    expect(visibleTo([org("contributor")])).toEqual(["mine", "owned"]);
  });

  it("a site-scoped risk owner sees owned risks and risks at their site, not other sites", () => {
    expect(visibleTo([site("risk_owner", SITE_A)])).toEqual([
      "mine",
      "owned",
      "a-proposed",
      "a-approved",
      "a-closed",
    ]);
  });

  it("a viewer sees approved and closed risks only, never proposed", () => {
    expect(visibleTo([org("viewer")])).toEqual([
      "mine",
      "owned",
      "a-approved",
      "a-closed",
      "b-approved",
    ]);
    expect(visibleTo([site("viewer", SITE_A)])).toEqual([
      "mine",
      "owned",
      "a-approved",
      "a-closed",
    ]);
    expect(visibleTo([dept("viewer", DEPT_X)])).toEqual(["mine", "owned", "b-approved"]);
  });

  it("an org-scoped auditor sees every risk", () => {
    expect(visibleTo([org("auditor")])).toEqual(RISKS.map((r) => r.id));
    expect(visibleTo([org("ciso")])).toEqual(RISKS.map((r) => r.id));
    expect(visibleTo([org("risk_approver")])).toEqual(RISKS.map((r) => r.id));
  });

  it("an administrator without other roles sees only their own reports", () => {
    expect(visibleTo([org("administrator")])).toEqual(["mine", "owned"]);
    expect(visibleTo([])).toEqual(["mine", "owned"]);
  });

  it("department-scoped grants match the department; unusable scopes grant nothing", () => {
    expect(visibleTo([dept("auditor", DEPT_X)])).toEqual(["mine", "owned", "b-approved"]);
    expect(visibleTo([{ role: "ciso", scope: { type: "site", id: null } }])).toEqual([
      "mine",
      "owned",
    ]);
    expect(visibleTo([{ role: "ciso", scope: { type: "site", id: "" } }])).toEqual([
      "mine",
      "owned",
    ]);
  });
});
