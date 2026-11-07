import { describe, expect, it } from "vitest";
import {
  ConflictReasonSchema,
  DemoConfirmInput,
  DemoLoadResponse,
  DemoStatusResponse,
  allRoutes,
  buildOpenApiDocument,
  conditionalRoutes,
  demoRoutes,
} from "../src/index.js";

describe("demo contracts (spec §5.1)", () => {
  it("are conditional on demo mode, never in the always-on route list", () => {
    const routes = Object.values(demoRoutes);
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(route.conditional).toBe("demo");
      expect(allRoutes).not.toContain(route);
      expect(conditionalRoutes).toContain(route);
    }
    expect(allRoutes.filter((r) => r.conditional !== undefined)).toEqual([]);
    expect(conditionalRoutes.every((r) => r.conditional !== undefined)).toBe(true);
  });

  it("need organisation.manage; the two actions also need a recent sign-in", () => {
    const doc = buildOpenApiDocument(conditionalRoutes);
    const status = doc.paths?.["/api/v1/demo"]?.get;
    expect(status?.["x-permission"]).toBe("organisation.manage");
    expect(status?.["x-recent-auth"]).toBeUndefined();
    expect(status?.["x-conditional"]).toBe("demo");
    for (const path of ["/api/v1/demo/sample", "/api/v1/demo/reset"]) {
      const op = doc.paths?.[path]?.post;
      expect(op?.["x-permission"]).toBe("organisation.manage");
      expect(op?.["x-recent-auth"]).toBe(true);
      expect(op?.["x-conditional"]).toBe("demo");
      expect(JSON.stringify(op?.requestBody)).toContain("DemoConfirmInput");
      // Demo mode off: the route does not exist.
      expect(JSON.stringify(op?.responses?.["404"])).toContain("DEMO_TOOLS_ENABLED");
      expect(op?.responses?.["400"]).toBeDefined();
      expect(op?.summary).toContain("400 confirmationMismatch");
    }
    expect(doc.paths?.["/api/v1/demo/reset"]?.post?.responses?.["204"]).toBeDefined();
    expect(JSON.stringify(doc.paths?.["/api/v1/demo/sample"]?.post?.responses?.["200"])).toContain(
      "DemoLoadResponse",
    );
  });

  it("does not mark always-on routes conditional", () => {
    const doc = buildOpenApiDocument(allRoutes);
    expect(JSON.stringify(doc)).not.toContain("x-conditional");
  });

  it("shapes: status, confirmation and load counts", () => {
    expect(DemoStatusResponse.parse({ enabled: true, organisationName: null })).toEqual({
      enabled: true,
      organisationName: null,
    });
    expect(DemoStatusResponse.safeParse({ enabled: false, organisationName: null }).success).toBe(
      false,
    );
    // The server trims and compares; the contract keeps the text as typed.
    expect(DemoConfirmInput.parse({ confirm: "  RESET " })).toEqual({ confirm: "  RESET " });
    expect(DemoConfirmInput.safeParse({ confirm: "RESET", extra: 1 }).success).toBe(false);
    expect(DemoConfirmInput.safeParse({ confirm: "x".repeat(301) }).success).toBe(false);
    expect(DemoLoadResponse.safeParse({ risks: 1, people: 2, ms: 3, evidenceFailed: 0 })).toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(
      DemoLoadResponse.safeParse({ risks: 1.5, people: 2, ms: 3, evidenceFailed: 0 }).success,
    ).toBe(false);
  });

  it("names the confirmation mismatch as a reason", () => {
    expect(ConflictReasonSchema.options).toContain("confirmationMismatch");
  });
});
