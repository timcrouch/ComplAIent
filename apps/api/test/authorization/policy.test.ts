import { type Permission, PermissionSchema, type RoleAssignmentDto } from "@isms/contracts";
import { describe, expect, it } from "vitest";
import {
  BASELINE_PERMISSIONS,
  DEFAULT_SCOPED_PERMISSIONS,
  PolicyService,
  ROLE_PERMISSIONS,
  type ResourceScope,
} from "../../src/authorization/index.js";
import type { Actor } from "../../src/identity/index.js";

/** Nothing scoped: the organisation-level rules on their own. */
const policy = new PolicyService([]);
/** As the app runs: the risk permissions are scoped (P3-R1). */
const defaults = new PolicyService();
const BASELINE = ["me.read", "me.update", "organisation.read"];

const actor = (roles: RoleAssignmentDto[]): Actor => ({
  userId: "u-1",
  email: "u@example.test",
  authTime: 0,
  authTimeSource: "auth_time",
  roles,
});

const adminOrg: RoleAssignmentDto = {
  role: "administrator",
  scope: { type: "organisation", id: null },
};
const contribOrg: RoleAssignmentDto = {
  role: "contributor",
  scope: { type: "organisation", id: null },
};
const cisoSiteA: RoleAssignmentDto = { role: "ciso", scope: { type: "site", id: "A" } };
const auditorDeptX: RoleAssignmentDto = {
  role: "auditor",
  scope: { type: "department", id: "X" },
};
const auditorOrg: RoleAssignmentDto = {
  role: "auditor",
  scope: { type: "organisation", id: null },
};

const siteEmpty: RoleAssignmentDto = { role: "ciso", scope: { type: "site", id: "" } };
const deptEmpty: RoleAssignmentDto = { role: "auditor", scope: { type: "department", id: "" } };

describe("ROLE_PERMISSIONS", () => {
  it("has the initial values for every role", () => {
    expect(ROLE_PERMISSIONS).toEqual({
      administrator: [
        "me.read",
        "users.list",
        "roles.assign",
        "audit.read",
        "settings.ai.manage",
        "library.read",
        "organisation.manage",
        "risks.report",
        "ai.transcripts.read",
      ],
      ciso: [
        "me.read",
        "users.list",
        "audit.read",
        "library.read",
        "library.review",
        "risks.report",
        "risks.read",
        "risks.review",
        "controls.test",
        "ai.transcripts.read",
        "reports.read",
        "reports.narrative",
        "soa.manage",
      ],
      auditor: [
        "me.read",
        "audit.read",
        "library.read",
        "risks.read",
        "ai.transcripts.read",
        "reports.read",
      ],
      risk_owner: [
        "me.read",
        "library.read",
        "risks.report",
        "risks.read",
        "risks.review",
        "controls.test",
      ],
      risk_approver: [
        "me.read",
        "library.read",
        "risks.report",
        "risks.read",
        "risks.approve",
        "reports.read",
        "reports.narrative",
      ],
      contributor: ["me.read", "risks.report"],
      viewer: ["me.read", "library.read", "risks.report", "risks.read"],
    });
  });

  it("every authenticated actor may read their profile, save preferences and read setup", () => {
    expect(BASELINE_PERMISSIONS).toEqual(["me.read", "me.update", "organisation.read"]);
  });
});

describe("PolicyService.can", () => {
  it.each<[string, RoleAssignmentDto[], Permission, ResourceScope | undefined, boolean]>([
    ["org admin, no resource", [adminOrg], "users.list", undefined, true],
    ["contributor cannot list users", [contribOrg], "users.list", undefined, false],
    ["site-scoped ciso matches own site", [cisoSiteA], "audit.read", { siteId: "A" }, true],
    ["site-scoped ciso denied other site", [cisoSiteA], "audit.read", { siteId: "B" }, false],
    ["site-scoped ciso denied org-level", [cisoSiteA], "audit.read", undefined, false],
    ["org admin matches any site", [adminOrg], "audit.read", { siteId: "B" }, true],
    ["org admin matches any department", [adminOrg], "audit.read", { departmentId: "Y" }, true],
    [
      "dept auditor matches own department",
      [auditorDeptX],
      "audit.read",
      { departmentId: "X" },
      true,
    ],
    [
      "dept auditor denied other department",
      [auditorDeptX],
      "audit.read",
      { departmentId: "Y" },
      false,
    ],
    ["dept auditor denied org-level", [auditorDeptX], "audit.read", undefined, false],
    [
      "site scope does not match a department id",
      [cisoSiteA],
      "audit.read",
      { departmentId: "A" },
      false,
    ],
    ["dept scope does not match a site id", [auditorDeptX], "audit.read", { siteId: "X" }, false],
    ["site scope denied for an empty resource", [cisoSiteA], "audit.read", {}, false],
    ["role without the permission in scope", [cisoSiteA], "roles.assign", { siteId: "A" }, false],
    ["no roles, no permission", [], "users.list", undefined, false],
    ["no roles still reads own profile", [], "me.read", undefined, true],
    [
      "any one matching assignment suffices",
      [contribOrg, auditorOrg],
      "audit.read",
      undefined,
      true,
    ],
    // Empty ids are treated like null: they never match, not even an empty resource id.
    ["empty site id never matches", [siteEmpty], "audit.read", { siteId: "" }, false],
    ["empty department id never matches", [deptEmpty], "audit.read", { departmentId: "" }, false],
    ["empty resource site id never matches", [cisoSiteA], "audit.read", { siteId: "" }, false],
  ])("%s", (_n, roles, perm, res, expected) => {
    expect(policy.can(actor(roles), perm, res)).toBe(expected);
  });

  it("ignores unknown roles and scope types from the database without throwing", () => {
    const bogus = [
      { role: "superuser", scope: { type: "organisation", id: null } },
      { role: "__proto__", scope: { type: "organisation", id: null } },
      { role: "constructor", scope: { type: "organisation", id: null } },
      { role: "administrator", scope: { type: "galaxy", id: null } },
      { role: "administrator", scope: { type: "site", id: null } },
    ] as unknown as RoleAssignmentDto[];
    for (const perm of ["users.list", "audit.read", "roles.assign"] as const) {
      expect(policy.can(actor(bogus), perm)).toBe(false);
      expect(policy.can(actor(bogus), perm, { siteId: "A" })).toBe(false);
    }
    expect(policy.permissionsFor(actor(bogus))).toEqual(BASELINE);
  });

  it("does not match a site-scoped role with a null id against a resource without site", () => {
    const nullSite = [
      { role: "administrator", scope: { type: "site", id: null } },
    ] as RoleAssignmentDto[];
    expect(policy.can(actor(nullSite), "users.list", { departmentId: "D" })).toBe(false);
  });
});

describe("PolicyService.permissionsFor", () => {
  it("permissionsFor unions without duplicates", () => {
    const perms = policy.permissionsFor(actor([cisoSiteA, auditorOrg, adminOrg, contribOrg]));
    expect(perms).toEqual([
      "me.read",
      "me.update",
      "organisation.read",
      "audit.read",
      "library.read",
      "risks.read",
      "ai.transcripts.read",
      "reports.read",
      "users.list",
      "roles.assign",
      "settings.ai.manage",
      "organisation.manage",
      "risks.report",
    ]);
    expect(new Set(perms).size).toBe(perms.length);
  });

  it("excludes permissions held only through scoped assignments (R21)", () => {
    expect(policy.permissionsFor(actor([cisoSiteA]))).toEqual(BASELINE);
    // The org-scoped contributor's own risks.report is the only addition.
    expect(policy.permissionsFor(actor([auditorDeptX, cisoSiteA, contribOrg]))).toEqual([
      ...BASELINE,
      "risks.report",
    ]);
    expect(policy.permissionsFor(actor([siteEmpty, deptEmpty]))).toEqual(BASELINE);
  });

  it("reports exactly what can() grants without a resource, for every subset of roles", () => {
    const pool: RoleAssignmentDto[] = [
      adminOrg,
      contribOrg,
      cisoSiteA,
      auditorDeptX,
      auditorOrg,
      siteEmpty,
      { role: "ciso", scope: { type: "organisation", id: null } },
      { role: "viewer", scope: { type: "site", id: "B" } },
      { role: "administrator", scope: { type: "department", id: "Z" } },
    ];
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const a = actor(pool.filter((_, i) => (mask & (1 << i)) !== 0));
      const reported = policy.permissionsFor(a);
      for (const p of PermissionSchema.options) {
        expect(policy.can(a, p), `${p}, subset ${String(mask)}`).toBe(reported.includes(p));
      }
    }
  });

  it("a user without roles has only the baseline", () => {
    expect(policy.permissionsFor(actor([]))).toEqual(BASELINE);
  });
});

describe("scoped permissions (P2-R10)", () => {
  // audit.read stands in for the risk permissions Plan 3 adds to the scoped set.
  const scoped = new PolicyService(["audit.read"]);
  /** The route guard's rule: scoped permissions at any scope, the rest at organisation level. */
  const guardAllows = (a: Actor, p: Permission): boolean =>
    scoped.isScoped(p) ? scoped.canAtAnyScope(a, p) : scoped.can(a, p);

  it("the default scoped set is the risk permissions (P3-R1), library.read (P6-R5) and reports.read; controls.test stays organisation-level (#24)", () => {
    expect(DEFAULT_SCOPED_PERMISSIONS).toEqual([
      "risks.report",
      "risks.read",
      "risks.review",
      "risks.approve",
      "ai.transcripts.read",
      "library.read",
      "reports.read",
    ]);
    expect(defaults.isScoped("controls.test")).toBe(false);
    expect(defaults.isScoped("library.read")).toBe(true);
    expect(defaults.isScoped("risks.read")).toBe(true);
    // Reporting is not restricted by unit: a scoped holder passes the guard.
    expect(defaults.isScoped("risks.report")).toBe(true);
    expect(defaults.isScoped("users.list")).toBe(false);
    expect(policy.isScoped("audit.read")).toBe(false);
    expect(scoped.isScoped("audit.read")).toBe(true);
  });

  it("canAtAnyScope is true for a site-scoped holder", () => {
    expect(scoped.canAtAnyScope(actor([cisoSiteA]), "audit.read")).toBe(true);
    expect(scoped.canAtAnyScope(actor([auditorDeptX]), "audit.read")).toBe(true);
    expect(scoped.canAtAnyScope(actor([auditorOrg]), "audit.read")).toBe(true);
    expect(scoped.canAtAnyScope(actor([contribOrg]), "audit.read")).toBe(false);
    expect(scoped.canAtAnyScope(actor([cisoSiteA]), "roles.assign")).toBe(false);
    // An empty unit id is no scope at all.
    expect(scoped.canAtAnyScope(actor([siteEmpty, deptEmpty]), "audit.read")).toBe(false);
    expect(scoped.canAtAnyScope(actor([]), "me.read")).toBe(true);
  });

  it("accessScope: org role → organisation; site + department roles → units with both ids; none → none", () => {
    expect(scoped.accessScope(actor([auditorOrg, cisoSiteA]), "audit.read")).toEqual({
      kind: "organisation",
    });
    const cisoSiteB: RoleAssignmentDto = { role: "ciso", scope: { type: "site", id: "B" } };
    expect(
      scoped.accessScope(
        actor([cisoSiteA, auditorDeptX, cisoSiteB, { ...cisoSiteA, role: "auditor" }, siteEmpty]),
        "audit.read",
      ),
    ).toEqual({ kind: "units", siteIds: ["A", "B"], departmentIds: ["X"] });
    expect(scoped.accessScope(actor([contribOrg]), "audit.read")).toEqual({ kind: "none" });
    expect(scoped.accessScope(actor([]), "audit.read")).toEqual({ kind: "none" });
  });

  it("assertCanAccess throws NOT_FOUND for a resource outside the actor's units", () => {
    const a = actor([cisoSiteA]);
    expect(() => {
      scoped.assertCanAccess(a, "audit.read", { siteId: "A" });
    }).not.toThrow();
    for (const resource of [{ siteId: "B" }, { departmentId: "A" }, {}]) {
      expect(() => {
        scoped.assertCanAccess(a, "audit.read", resource);
      }).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "Not found" }));
    }
    expect(() => {
      scoped.assertCanAccess(actor([auditorOrg]), "audit.read", { siteId: "B" });
    }).not.toThrow();
  });

  it("permissionsFor includes a scoped permission held at site scope, not an unscoped one", () => {
    // ciso also holds users.list, which is not scoped, so a site-scoped ciso does not get it.
    expect(scoped.permissionsFor(actor([cisoSiteA]))).toEqual([...BASELINE, "audit.read"]);
    expect(policy.permissionsFor(actor([cisoSiteA]))).toEqual(BASELINE);
    // As the app runs, a site-scoped ciso reports, reads and reviews risks and reads
    // transcripts; its unscoped permissions (users.list, audit.read, ...) stay org-only.
    expect(defaults.permissionsFor(actor([cisoSiteA]))).toEqual([
      ...BASELINE,
      "library.read",
      "risks.report",
      "risks.read",
      "risks.review",
      "ai.transcripts.read",
      "reports.read",
    ]);
    const contributorSiteA: RoleAssignmentDto = { ...cisoSiteA, role: "contributor" };
    expect(defaults.permissionsFor(actor([contributorSiteA]))).toEqual([
      ...BASELINE,
      "risks.report",
    ]);
  });

  it("permissionsFor reports exactly what the guard grants, for every subset of roles", () => {
    const pool: RoleAssignmentDto[] = [
      adminOrg,
      contribOrg,
      cisoSiteA,
      auditorDeptX,
      siteEmpty,
      deptEmpty,
      { role: "ciso", scope: { type: "organisation", id: null } },
      { role: "administrator", scope: { type: "department", id: "Z" } },
    ];
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const a = actor(pool.filter((_, i) => (mask & (1 << i)) !== 0));
      const reported = scoped.permissionsFor(a);
      expect(new Set(reported).size).toBe(reported.length);
      for (const p of PermissionSchema.options) {
        expect(guardAllows(a, p), `${p}, subset ${String(mask)}`).toBe(reported.includes(p));
      }
    }
  });
});
