import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConflictReasonSchema,
  allRoutes,
  buildOpenApiDocument,
  conditionalRoutes,
  defineRoute,
} from "../src/index.js";

describe("buildOpenApiDocument", () => {
  // The full contract: always-on routes plus those only some instances register (x-conditional).
  const doc = buildOpenApiDocument([...allRoutes, ...conditionalRoutes]);

  it("is OpenAPI 3.1 with title and version", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "ISMS API", version: "1" });
  });

  it("documents /me with success and auto-added error responses", () => {
    const responses = doc.paths?.["/api/v1/me"]?.get?.responses;
    expect(responses?.["200"]).toBeDefined();
    for (const code of ["400", "401", "403", "429", "500", "503"]) {
      expect(responses?.[code]).toBeDefined();
    }
    expect(JSON.stringify(responses?.["503"])).toContain("AUTH_UNAVAILABLE");
    expect(responses?.["413"]).toBeUndefined(); // no body
  });

  it("documents PATCH /me/preferences with a strict body and the saved view mode", () => {
    const op = doc.paths?.["/api/v1/me/preferences"]?.patch;
    expect(JSON.stringify(op?.requestBody)).toContain("UpdatePreferencesRequest");
    expect(JSON.stringify(op?.responses?.["200"])).toContain("PreferencesResponse");
    expect(op?.responses?.["400"]).toBeDefined();
    expect(op?.responses?.["413"]).toBeDefined();
  });

  it("documents public probes without auth, throttling or auth-outage responses", () => {
    for (const path of ["/api/v1/health", "/api/v1/ready"]) {
      const responses = doc.paths?.[path]?.get?.responses ?? {};
      for (const code of ["401", "403", "429", "413"]) expect(responses[code]).toBeUndefined();
      expect(JSON.stringify(responses)).not.toContain("AUTH_UNAVAILABLE");
      expect(responses["500"]).toBeDefined();
    }
    // ready's own 503 (a failed dependency) is kept as declared.
    expect(JSON.stringify(doc.paths?.["/api/v1/ready"]?.get?.responses?.["503"])).toContain(
      "ReadyResponse",
    );
  });

  it("every non-public route declares a permission", () => {
    const publicPaths = new Set(["/api/v1/health", "/api/v1/ready"]);
    const unguarded = [...allRoutes, ...conditionalRoutes]
      .filter((route) => !publicPaths.has(route.path) && route.permission === undefined)
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(unguarded).toEqual([]);
  });

  it("adds 413 and 429 for routes with a body and documents recent-auth", () => {
    const route = defineRoute({
      method: "post",
      path: "/api/v1/things/{id}",
      summary: "Do thing",
      recentAuth: true,
      request: {
        params: z.object({ id: z.string() }),
        body: z.object({ a: z.string() }),
      },
      responses: { 200: z.object({ ok: z.boolean() }) },
    });
    const responses = buildOpenApiDocument([route]).paths?.["/api/v1/things/{id}"]?.post?.responses;
    expect(responses?.["429"]).toBeDefined();
    expect(responses?.["413"]).toBeDefined();
    expect(JSON.stringify(responses?.["403"])).toContain("RECENT_AUTH_REQUIRED");
  });

  it("does not mutate input routes", () => {
    const before = JSON.stringify(allRoutes.map((r) => Object.keys(r.responses)));
    buildOpenApiDocument(allRoutes);
    expect(JSON.stringify(allRoutes.map((r) => Object.keys(r.responses)))).toBe(before);
  });

  it("documents the people routes: role changes need a recent sign-in and report conflicts", () => {
    const list = doc.paths?.["/api/v1/users"]?.get;
    expect(list?.["x-permission"]).toBe("users.list");
    expect(list?.["x-recent-auth"]).toBeUndefined();
    const grant = doc.paths?.["/api/v1/users/{userId}/roles"]?.post;
    const revoke = doc.paths?.["/api/v1/role-assignments/{assignmentId}"]?.delete;
    for (const op of [grant, revoke]) {
      expect(op?.["x-permission"]).toBe("roles.assign");
      expect(op?.["x-recent-auth"]).toBe(true);
      expect(op?.responses?.["404"]).toBeDefined();
      expect(op?.responses?.["409"]).toBeDefined();
    }
    expect(JSON.stringify(grant?.responses?.["201"])).toContain("RoleAssignmentDetailDto");
    expect(JSON.stringify(grant?.requestBody)).toContain("GrantRoleRequest");
  });

  it("documents the library routes: reading needs library.read, reviewing library.review", () => {
    const read = [
      doc.paths?.["/api/v1/library/frameworks"]?.get,
      doc.paths?.["/api/v1/library/controls"]?.get,
      doc.paths?.["/api/v1/library/controls/{code}"]?.get,
      doc.paths?.["/api/v1/library/export"]?.get,
    ];
    for (const op of read) expect(op?.["x-permission"]).toBe("library.read");
    const review = doc.paths?.["/api/v1/library/mappings/{mappingId}/review"]?.post;
    expect(review?.["x-permission"]).toBe("library.review");
    expect(review?.requestBody).toBeUndefined();
    expect(review?.responses?.["404"]).toBeDefined();
    expect(JSON.stringify(review?.responses?.["200"])).toContain("MappingDto");
  });

  it("documents the organisation routes: everyone reads, administrators change setup", () => {
    expect(doc.paths?.["/api/v1/organisation"]?.get?.["x-permission"]).toBe("organisation.read");
    const writes = [
      doc.paths?.["/api/v1/organisation/profile"]?.put,
      doc.paths?.["/api/v1/organisation/units"]?.put,
      doc.paths?.["/api/v1/organisation/frameworks"]?.put,
      doc.paths?.["/api/v1/organisation/frameworks/suggestions"]?.post,
      doc.paths?.["/api/v1/organisation/risk-scale"]?.put,
      doc.paths?.["/api/v1/organisation/setup/complete"]?.post,
      doc.paths?.["/api/v1/organisation/modules/{key}"]?.put,
    ];
    for (const op of writes) expect(op?.["x-permission"]).toBe("organisation.manage");
    const units = doc.paths?.["/api/v1/organisation/units"]?.put;
    expect(JSON.stringify(units?.requestBody)).toContain("UnitsInput");
    expect(JSON.stringify(units?.responses?.["200"])).toContain("UnitsResponse");
    expect(units?.responses?.["409"]).toBeDefined();
    const complete = doc.paths?.["/api/v1/organisation/setup/complete"]?.post;
    expect(complete?.responses?.["200"]).toBeDefined();
    expect(complete?.responses?.["409"]).toBeDefined();
    // PF4: sites and departments are replaced together, never one at a time.
    expect(doc.paths?.["/api/v1/organisation/sites"]).toBeUndefined();
    expect(doc.paths?.["/api/v1/organisation/departments"]).toBeUndefined();
  });

  it("contains exactly the foundation, people, library, organisation, risk, AI settings and concern routes", () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      "/api/v1/ai-act/systems",
      "/api/v1/ai-act/systems/{id}",
      "/api/v1/ai-act/systems/{id}/classification",
      "/api/v1/ai-act/systems/{id}/classification/draft",
      "/api/v1/ai-act/systems/{id}/obligations/{key}",
      "/api/v1/ai-act/systems/{id}/obligations/{key}/guidance",
      "/api/v1/ai-act/systems/{id}/risks",
      "/api/v1/ai-act/systems/{id}/risks/{riskId}",
      "/api/v1/concern-evaluations/queue",
      "/api/v1/concerns",
      "/api/v1/concerns/ai-status",
      "/api/v1/concerns/{id}",
      "/api/v1/concerns/{id}/abandon",
      "/api/v1/concerns/{id}/messages",
      "/api/v1/concerns/{id}/submit",
      "/api/v1/demo",
      "/api/v1/demo/reset",
      "/api/v1/demo/sample",
      "/api/v1/evidence/{id}/content",
      "/api/v1/health",
      "/api/v1/library/controls",
      "/api/v1/library/controls/{code}",
      "/api/v1/library/controls/{code}/operation",
      "/api/v1/library/controls/{code}/test-steps",
      "/api/v1/library/controls/{code}/tests",
      "/api/v1/library/export",
      "/api/v1/library/frameworks",
      "/api/v1/library/mappings/{mappingId}/review",
      "/api/v1/me",
      "/api/v1/me/concerns",
      "/api/v1/me/preferences",
      "/api/v1/me/security-contribution",
      "/api/v1/me/tasks",
      "/api/v1/organisation",
      "/api/v1/organisation/concern-rewards",
      "/api/v1/organisation/concern-rewards/resume",
      "/api/v1/organisation/frameworks",
      "/api/v1/organisation/frameworks/suggestions",
      "/api/v1/organisation/modules/{key}",
      "/api/v1/organisation/profile",
      "/api/v1/organisation/review-interval",
      "/api/v1/organisation/risk-scale",
      "/api/v1/organisation/setup/complete",
      "/api/v1/organisation/units",
      "/api/v1/ready",
      "/api/v1/reports/board",
      "/api/v1/reports/board.pdf",
      "/api/v1/reports/board/narrative",
      "/api/v1/reports/board/narrative-draft",
      "/api/v1/reports/register",
      "/api/v1/reports/register.pdf",
      "/api/v1/reports/register.xlsx",
      "/api/v1/reports/soa",
      "/api/v1/reports/soa.pdf",
      "/api/v1/reports/soa.xlsx",
      "/api/v1/reports/soa/{requirementId}",
      "/api/v1/risks",
      "/api/v1/risks/map",
      "/api/v1/risks/{id}",
      "/api/v1/risks/{id}/actions",
      "/api/v1/risks/{id}/approve",
      "/api/v1/risks/{id}/close",
      "/api/v1/risks/{id}/concern-evaluation",
      "/api/v1/risks/{id}/control-suggestions",
      "/api/v1/risks/{id}/controls",
      "/api/v1/risks/{id}/controls/{riskControlId}",
      "/api/v1/risks/{id}/controls/{riskControlId}/decision",
      "/api/v1/risks/{id}/conversation",
      "/api/v1/risks/{id}/evidence",
      "/api/v1/risks/{id}/evidence-requests",
      "/api/v1/risks/{id}/reassess",
      "/api/v1/risks/{id}/return",
      "/api/v1/risks/{id}/review-confirmation",
      "/api/v1/risks/{id}/submit",
      "/api/v1/role-assignments/{assignmentId}",
      "/api/v1/settings/ai",
      "/api/v1/settings/ai/key",
      "/api/v1/settings/ai/models",
      "/api/v1/settings/ai/test",
      "/api/v1/tasks/{id}/cancel",
      "/api/v1/tasks/{id}/complete",
      "/api/v1/tasks/{id}/evidence",
      "/api/v1/users",
      "/api/v1/users/{userId}/roles",
      "/api/v1/workspace",
    ]);
  });

  it("documents framework suggestions (AI may be unavailable) and the workspace for everyone", () => {
    const suggest = doc.paths?.["/api/v1/organisation/frameworks/suggestions"]?.post;
    expect(JSON.stringify(suggest?.responses?.["200"])).toContain("FrameworksResponse");
    expect(suggest?.responses?.["409"]).toBeDefined();
    const workspace = doc.paths?.["/api/v1/workspace"]?.get;
    expect(workspace?.["x-permission"]).toBe("me.read");
    expect(JSON.stringify(workspace?.responses?.["200"])).toContain("WorkspaceResponse");
  });

  it("documents evidence uploads and downloads as octet-stream", () => {
    const upload = doc.paths?.["/api/v1/risks/{id}/evidence"]?.post;
    expect(upload?.["x-permission"]).toBe("risks.review");
    expect(JSON.stringify(upload?.requestBody)).toContain("application/octet-stream");
    expect(JSON.stringify(upload?.requestBody)).not.toContain("application/json");
    expect(JSON.stringify(upload?.responses?.["413"])).toContain("EVIDENCE_MAX_BYTES");
    expect(JSON.stringify(upload?.responses?.["201"])).toContain("EvidenceDto");
    const forTask = doc.paths?.["/api/v1/tasks/{id}/evidence"]?.post;
    expect(forTask?.["x-permission"]).toBe("me.read");
    expect(JSON.stringify(forTask?.requestBody)).toContain("application/octet-stream");
    // PF4: the assignee of the task the evidence completed may download it too.
    const download = doc.paths?.["/api/v1/evidence/{id}/content"]?.get;
    expect(download?.["x-permission"]).toBe("me.read");
    const ok = download?.responses?.["200"] as { content?: Record<string, unknown> } | undefined;
    expect(Object.keys(ok?.content ?? {})).toEqual(["application/octet-stream"]);
    expect(download?.responses?.["413"]).toBeUndefined();
    expect(doc.paths?.["/api/v1/me/tasks"]?.get?.["x-permission"]).toBe("me.read");
    expect(doc.paths?.["/api/v1/risks/{id}/evidence-requests"]?.post?.["x-permission"]).toBe(
      "risks.review",
    );
  });

  it("documents submit, approve and return: SoD refusals are 409s, not route permissions", () => {
    const op = (action: string) => doc.paths?.[`/api/v1/risks/{id}/${action}`]?.post;
    expect(op("submit")?.["x-permission"]).toBe("risks.review");
    expect(op("approve")?.["x-permission"]).toBe("risks.read");
    expect(op("return")?.["x-permission"]).toBe("risks.read");
    for (const action of ["submit", "approve", "return"]) {
      expect(JSON.stringify(op(action)?.responses?.["200"])).toContain("RiskDetailDto");
      expect(op(action)?.responses?.["409"]).toBeDefined();
    }
  });

  it("publishes the conflict vocabulary and points every 409 at it (P2-R8)", () => {
    const schema = doc.components?.schemas?.["ConflictReason"] as { enum?: string[] } | undefined;
    expect(schema?.enum).toEqual(ConflictReasonSchema.options);
    const conflicts: [string, "post" | "delete" | "put"][] = [
      ["/api/v1/users/{userId}/roles", "post"],
      ["/api/v1/role-assignments/{assignmentId}", "delete"],
      ["/api/v1/organisation/units", "put"],
      ["/api/v1/organisation/frameworks/suggestions", "post"],
      ["/api/v1/organisation/setup/complete", "post"],
    ];
    for (const [path, method] of conflicts) {
      const conflict = doc.paths?.[path]?.[method]?.responses?.["409"] as
        { description?: string } | undefined;
      expect(conflict?.description).toBe(
        "CONFLICT: details[].path is a ConflictReason, or `<reason>.<item>`",
      );
    }
  });

  it("documents the AI Act module: every route is x-module, 404 while off, aiact.* permissions", () => {
    const ops = Object.entries(doc.paths ?? {})
      .filter(([path]) => path.startsWith("/api/v1/ai-act/"))
      .flatMap(([, item]) =>
        (["get", "post", "put", "patch", "delete"] as const)
          .map((method) => item[method])
          .filter((op) => op !== undefined),
      );
    expect(ops).toHaveLength(10);
    for (const op of ops) {
      expect(op["x-module"]).toBe("eu_ai_act");
      expect(op.responses?.["404"]).toBeDefined();
      expect(["aiact.read", "aiact.manage"]).toContain(op["x-permission"]);
    }
    const list = doc.paths?.["/api/v1/ai-act/systems"]?.get;
    expect(list?.["x-permission"]).toBe("aiact.read");
    expect(JSON.stringify(list?.responses?.["404"])).toContain("eu_ai_act module is on");
    const classify = doc.paths?.["/api/v1/ai-act/systems/{id}/classification"]?.put;
    expect(classify?.["x-permission"]).toBe("aiact.manage");
    expect(JSON.stringify(classify?.requestBody)).toContain("ClassifyAiSystemInput");
    expect(doc.paths?.["/api/v1/ai-act/systems/{id}"]?.delete).toBeUndefined();
    // Not a module route: the switch itself is always there.
    expect(doc.paths?.["/api/v1/organisation/modules/{key}"]?.put?.["x-module"]).toBeUndefined();
  });

  it("matches the contract snapshot", () => {
    expect(JSON.stringify(doc, null, 2)).toMatchSnapshot();
  });
});
