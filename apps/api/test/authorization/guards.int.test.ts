import type { Server } from "node:http";
import {
  Controller,
  type ExecutionContext,
  Get,
  type INestApplication,
  Module,
  Param,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { type Role, defineRoute } from "@isms/contracts";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { DomainError } from "@isms/domain";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import {
  AccessGuard,
  AuthorizationModule,
  type ModuleGate,
  PermissionGuard,
  PolicyService,
} from "../../src/authorization/index.js";
import {
  type Actor,
  type AuthGuard,
  CurrentActor,
  IdentityModule,
} from "../../src/identity/index.js";
import {
  ContractRoute,
  InfrastructureModule,
  PlatformModule,
  configureApp,
} from "../../src/platform/index.js";
import { SystemModule } from "../../src/system/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const ok = z.object({ ok: z.boolean() });
const routes = {
  users: defineRoute({
    method: "get",
    path: "/api/v1/_test/users",
    summary: "test only",
    permission: "users.list",
    responses: { 200: ok },
  }),
  sensitive: defineRoute({
    method: "get",
    path: "/api/v1/_test/sensitive",
    summary: "test only",
    permission: "users.list",
    recentAuth: true,
    responses: { 200: ok },
  }),
  recentOnly: defineRoute({
    method: "get",
    path: "/api/v1/_test/recent-only",
    summary: "test only",
    recentAuth: true,
    responses: { 200: ok },
  }),
  open: defineRoute({
    method: "get",
    path: "/api/v1/_test/open-contract",
    summary: "test only",
    responses: { 200: ok },
  }),
  // audit.read is in this app's scoped set (AuthorizationModule.forRoot below).
  scoped: defineRoute({
    method: "get",
    path: "/api/v1/_test/scoped",
    summary: "test only",
    permission: "audit.read",
    responses: { 200: ok },
  }),
  scopedResource: defineRoute({
    method: "get",
    path: "/api/v1/_test/sites/{siteId}/thing",
    summary: "test only",
    permission: "audit.read",
    request: { params: z.object({ siteId: z.string() }) },
    responses: { 200: ok },
  }),
};

@Controller()
class TestController {
  constructor(private readonly policy: PolicyService) {}

  @ContractRoute(routes.scoped)
  scoped(): { ok: true } {
    return { ok: true };
  }

  /** Stands in for a service check; a real service reads the unit from the stored resource. */
  @ContractRoute(routes.scopedResource)
  scopedResource(@CurrentActor() actor: Actor, @Param("siteId") siteId: string): { ok: true } {
    this.policy.assertCanAccess(actor, "audit.read", { siteId });
    return { ok: true };
  }

  @ContractRoute(routes.users)
  users(): { ok: true } {
    return { ok: true };
  }

  @ContractRoute(routes.sensitive)
  sensitive(): { ok: true } {
    return { ok: true };
  }

  @ContractRoute(routes.recentOnly)
  recentOnly(): { ok: true } {
    return { ok: true };
  }

  @ContractRoute(routes.open)
  open(): { ok: true } {
    return { ok: true };
  }

  @Get("/api/v1/_test/plain")
  plain(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

// Whole seconds, so `now - authTime` is exact.
const NOW_S = Math.floor(Date.parse("2026-11-03T12:00:00Z") / 1000);
const clock = { now: () => new Date(NOW_S * 1000) };

type ErrorBody = { error: { code: string; message: string; requestId: string } };

describe("PermissionGuard", () => {
  let idp: JwksServer;
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    idp = await new JwksServer().start();
    idp.keys = [await makeKey("key-1")];
    const moduleRef = await Test.createTestingModule({
      imports: [
        PlatformModule.forRoot({
          logLevel: "silent",
          service: "isms-api-test",
          rateLimitPerMinute: 1000,
          rateLimitPerIpPerMinute: 1000,
          throttleTrustedIps: [],
        }),
        InfrastructureModule.forRoot({
          databaseUrl: env.DATABASE_TEST_URL,
          redisUrl: env.REDIS_URL,
        }),
        SystemModule,
        IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api", clock }),
        // No clock here: authorization must use identity's CLOCK, or the fixed-time
        // recent-auth tests below would be judged against the real time and fail.
        AuthorizationModule.forRoot({ scopedPermissions: ["audit.read"] }),
        TestModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, { trustProxy: false });
    await app.init();
  });
  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterAll(async () => {
    await app.close();
    await idp.stop();
    await db.$disconnect();
  });

  /**
   * Creates the user ahead of their first request and grants `role` at the given scope.
   * Returns the id of the site or department created for a scoped grant.
   */
  async function grant(
    sub: string,
    role: Role,
    scope: { type: "ORGANISATION" | "SITE" | "DEPARTMENT" } = { type: "ORGANISATION" },
  ): Promise<string | null> {
    const user = await db.user.create({
      data: {
        idpIssuer: idp.issuer,
        idpSubject: sub,
        email: `${sub}@example.test`,
        displayName: sub,
      },
    });
    // Scoped assignments need a real Site / Department row (foreign keys).
    const siteId =
      scope.type === "SITE"
        ? (await db.site.create({ data: { name: sub, nameKey: sub, countryCode: "LV" } })).id
        : null;
    const departmentId =
      scope.type === "DEPARTMENT"
        ? (await db.department.create({ data: { name: sub, nameKey: sub } })).id
        : null;
    await db.roleAssignment.create({
      data: {
        userId: user.id,
        role,
        scopeType: scope.type,
        siteId,
        departmentId,
        grantedById: user.id,
      },
    });
    return siteId ?? departmentId;
  }

  const token = (sub: string, authAgeSeconds = 10) =>
    idp.sign({
      sub,
      email: `${sub}@example.test`,
      iat: NOW_S,
      exp: NOW_S + 300,
      auth_time: NOW_S - authAgeSeconds,
    });

  const get = async (path: string, bearer?: string) => {
    const req = request(server()).get(path);
    return bearer === undefined ? req : req.set("authorization", `Bearer ${bearer}`);
  };

  describe("permissions", () => {
    it("403 FORBIDDEN for contributor", async () => {
      await grant("contrib", "contributor");
      const res = await get("/api/v1/_test/users", await token("contrib"));
      expect(res.status).toBe(403);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toBe("You don't have access to this");
      expect(body.error.requestId).toBeTruthy();
    });

    it("200 for an organisation administrator", async () => {
      await grant("admin", "administrator");
      expect((await get("/api/v1/_test/users", await token("admin"))).status).toBe(200);
    });

    it("403 for a user without any role", async () => {
      const res = await get("/api/v1/_test/users", await token("nobody"));
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    });

    it("a site-scoped role does not satisfy a route-level (organisation) check", async () => {
      await grant("site-admin", "administrator", { type: "SITE" });
      const res = await get("/api/v1/_test/users", await token("site-admin"));
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    });

    it("an authenticated contract route without a permission allows any signed-in user", async () => {
      expect((await get("/api/v1/_test/open-contract", await token("nobody"))).status).toBe(200);
    });

    it("a non-contract route still needs a token and then passes", async () => {
      expect((await get("/api/v1/_test/plain")).status).toBe(401);
      expect((await get("/api/v1/_test/plain", await token("nobody"))).status).toBe(200);
    });

    it("public routes need no token", async () => {
      for (const path of ["/api/v1/health", "/api/v1/ready", "/api/v1/openapi.json"]) {
        expect((await get(path)).status).toBe(200);
      }
    });
  });

  describe("scoped permissions", () => {
    it("a site-scoped holder passes the guard for a scoped permission", async () => {
      await grant("site-auditor", "auditor", { type: "SITE" });
      expect((await get("/api/v1/_test/scoped", await token("site-auditor"))).status).toBe(200);
      // An unscoped permission of a scoped role still needs organisation scope.
      await grant("site-ciso", "ciso", { type: "SITE" });
      expect((await get("/api/v1/_test/users", await token("site-ciso"))).status).toBe(403);
      // Holding the role nowhere is still refused at the route.
      await grant("contrib", "contributor");
      const res = await get("/api/v1/_test/scoped", await token("contrib"));
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    });

    it("a service check hides another site's resource as 404", async () => {
      const siteA = await grant("site-auditor", "auditor", { type: "SITE" });
      const siteB = (await db.site.create({ data: { name: "B", nameKey: "b", countryCode: "DE" } }))
        .id;
      const bearer = await token("site-auditor");
      expect((await get(`/api/v1/_test/sites/${String(siteA)}/thing`, bearer)).status).toBe(200);
      const hidden = await get(`/api/v1/_test/sites/${siteB}/thing`, bearer);
      expect(hidden.status).toBe(404);
      expect((hidden.body as ErrorBody).error.code).toBe("NOT_FOUND");
      expect((hidden.body as ErrorBody).error.message).toBe("Not found");
      // An organisation-scoped holder reaches any site.
      await grant("org-auditor", "auditor");
      expect(
        (await get(`/api/v1/_test/sites/${siteB}/thing`, await token("org-auditor"))).status,
      ).toBe(200);
    });
  });

  describe("recent authentication", () => {
    it("403 RECENT_AUTH_REQUIRED when authTime is 301s old; 200 when 299s", async () => {
      await grant("admin", "administrator");
      const stale = await get("/api/v1/_test/sensitive", await token("admin", 301));
      expect(stale.status).toBe(403);
      const body = stale.body as ErrorBody;
      expect(body.error.code).toBe("RECENT_AUTH_REQUIRED");
      expect(body.error.message).toBe("Please sign in again to continue");
      expect((await get("/api/v1/_test/sensitive", await token("admin", 299))).status).toBe(200);
    });

    it("a token without auth_time never satisfies recentAuth, even with a fresh iat (R22)", async () => {
      await grant("admin", "administrator");
      const noAuthTime = await idp.sign({
        sub: "admin",
        email: "admin@example.test",
        iat: NOW_S,
        exp: NOW_S + 300,
        auth_time: undefined,
      });
      const res = await get("/api/v1/_test/sensitive", noAuthTime);
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("RECENT_AUTH_REQUIRED");
      // Identity still accepts it: routes without recentAuth work.
      expect((await get("/api/v1/_test/users", noAuthTime)).status).toBe(200);
    });

    it("exactly 300s is still recent", async () => {
      await grant("admin", "administrator");
      expect((await get("/api/v1/_test/sensitive", await token("admin", 300))).status).toBe(200);
    });

    it("a missing permission is reported before a stale sign-in", async () => {
      await grant("contrib", "contributor");
      const res = await get("/api/v1/_test/sensitive", await token("contrib", 3600));
      expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    });

    it("applies to routes that require only recent authentication", async () => {
      const stale = await get("/api/v1/_test/recent-only", await token("nobody", 301));
      expect((stale.body as ErrorBody).error.code).toBe("RECENT_AUTH_REQUIRED");
      expect((await get("/api/v1/_test/recent-only", await token("nobody", 1))).status).toBe(200);
    });

    it("does not apply to routes without recentAuth", async () => {
      await grant("admin", "administrator");
      expect((await get("/api/v1/_test/users", await token("admin", 3600))).status).toBe(200);
    });
  });

  describe("guard order", () => {
    it("authentication runs first: no token on a permissioned route is 401, not 403", async () => {
      for (const path of ["/api/v1/_test/users", "/api/v1/_test/sensitive"]) {
        const res = await get(path);
        expect(res.status).toBe(401);
        expect((res.body as ErrorBody).error.code).toBe("UNAUTHENTICATED");
      }
      const invalid = await get("/api/v1/_test/users", "not-a-jwt");
      expect((invalid.body as ErrorBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("AccessGuard calls AuthGuard, then the module gate, then PermissionGuard, and stops when authentication fails", async () => {
      const calls: string[] = [];
      const ctx = {} as ExecutionContext;
      const modules = {
        check: () => {
          calls.push("module");
          return Promise.resolve();
        },
      } as unknown as ModuleGate;
      const permission = {
        canActivate: () => {
          calls.push("permission");
          return true;
        },
      } as unknown as PermissionGuard;
      const passing = {
        canActivate: () => {
          calls.push("auth");
          return Promise.resolve(true);
        },
      } as unknown as AuthGuard;
      await expect(new AccessGuard(passing, modules, permission).canActivate(ctx)).resolves.toBe(
        true,
      );
      expect(calls).toEqual(["auth", "module", "permission"]);

      // A module that is off ends the request before the permission check (404, not 403).
      calls.length = 0;
      const off = {
        check: () => {
          calls.push("module");
          return Promise.reject(new DomainError("NOT_FOUND", "Not found"));
        },
      } as unknown as ModuleGate;
      await expect(new AccessGuard(passing, off, permission).canActivate(ctx)).rejects.toThrow(
        expect.objectContaining({ code: "NOT_FOUND" }),
      );
      expect(calls).toEqual(["auth", "module"]);

      calls.length = 0;
      const throwing = {
        canActivate: () => {
          calls.push("auth");
          return Promise.reject(new DomainError("UNAUTHENTICATED", "Sign-in required"));
        },
      } as unknown as AuthGuard;
      await expect(new AccessGuard(throwing, modules, permission).canActivate(ctx)).rejects.toThrow(
        DomainError,
      );
      expect(calls).toEqual(["auth"]);

      calls.length = 0;
      const denying = {
        canActivate: () => {
          calls.push("auth");
          return Promise.resolve(false);
        },
      } as unknown as AuthGuard;
      await expect(new AccessGuard(denying, modules, permission).canActivate(ctx)).resolves.toBe(
        false,
      );
      expect(calls).toEqual(["auth"]);
    });

    it("PermissionGuard alone fails closed when no actor is attached", () => {
      const guard = new PermissionGuard(new Reflector(), new PolicyService(), clock);
      const handler = (): void => undefined;
      const context = (path: string) =>
        ({
          getType: () => "http",
          getHandler: () => handler,
          switchToHttp: () => ({ getRequest: () => ({ path }) }),
        }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(context("/api/v1/_test/plain"))).toThrow(
        expect.objectContaining({ code: "UNAUTHENTICATED" }),
      );
      expect(guard.canActivate(context("/api/v1/health"))).toBe(true);
      expect(guard.canActivate({ getType: () => "rpc" } as unknown as ExecutionContext)).toBe(
        false,
      );
    });
  });
});
