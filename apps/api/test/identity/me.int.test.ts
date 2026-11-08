import type { Server } from "node:http";
import { Controller, Get, type INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { defineRoute } from "@isms/contracts";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../src/audit/index.js";
import { AuthorizationModule } from "../../src/authorization/index.js";
import {
  IdentityModule,
  type IdentityOptions,
  UserProvisioningService,
} from "../../src/identity/index.js";
import {
  ContractRoute,
  InfrastructureModule,
  PRISMA,
  type PrismaService,
  PlatformModule,
  configureApp,
} from "../../src/platform/index.js";
import { SystemModule } from "../../src/system/index.js";
import { JwksServer, makeKey } from "./jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const BOOTSTRAP_EMAIL = "Boss@Example.test";

const noPermissionRoute = defineRoute({
  method: "get",
  path: "/api/v1/_test/open-contract",
  summary: "test only",
  responses: { 200: z.object({ ok: z.boolean() }) },
});

@Controller()
class TestController {
  @Get("/api/v1/_test/plain")
  plain(): { ok: true } {
    return { ok: true };
  }

  @ContractRoute(noPermissionRoute)
  openContract(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

const server = (app: INestApplication): Server => app.getHttpServer() as Server;

async function buildApp(identity: IdentityOptions): Promise<INestApplication> {
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
      IdentityModule.forRoot(identity),
      AuthorizationModule.forRoot(),
      TestModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, { trustProxy: false });
  await app.init();
  return app;
}

type ErrorBody = { error: { code: string; message: string; requestId: string } };

describe("identity", () => {
  let idp: JwksServer;
  let app: INestApplication;

  beforeAll(async () => {
    idp = await new JwksServer().start();
    idp.keys = [await makeKey("key-1")];
    app = await buildApp({
      issuer: idp.issuer,
      audience: "isms-api",
      bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    });
  });
  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterAll(async () => {
    await app.close();
    await idp.stop();
    await db.$disconnect();
  });

  const me = async (token?: string) => {
    const req = request(server(app)).get("/api/v1/me");
    return token === undefined ? req : req.set("authorization", `Bearer ${token}`);
  };
  const admins = () => db.roleAssignment.count({ where: { role: "administrator" } });

  describe("AuthGuard", () => {
    it("missing token gives 401 UNAUTHENTICATED in contract shape", async () => {
      const res = await me();
      expect(res.status).toBe(401);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(body.error.message).toBe("Sign-in required");
      expect(body.error.requestId).toBeTruthy();
    });

    it.each([
      ["lowercase scheme", (t: string) => `bearer ${t}`],
      ["basic scheme", () => "Basic dXNlcjpwYXNz"],
      ["double space", (t: string) => `Bearer  ${t}`],
      ["trailing data", (t: string) => `Bearer ${t} extra`],
      ["no token", () => "Bearer "],
    ])("rejects a malformed Authorization header (%s)", async (_label, header) => {
      const token = await idp.sign();
      const res = await request(server(app)).get("/api/v1/me").set("authorization", header(token));
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).error.code).toBe("UNAUTHENTICATED");
      expect(await db.user.count()).toBe(0);
    });

    it("invalid token gives 401 without leaking the verifier's reason", async () => {
      const res = await me(await idp.sign({ aud: "other" }));
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).error.message).toBe("Sign-in required");
      expect(JSON.stringify(res.body)).not.toMatch(/aud|claim/i);
    });

    it("health, ready and openapi.json are public", async () => {
      for (const path of ["/api/v1/health", "/api/v1/ready", "/api/v1/openapi.json"]) {
        expect((await request(server(app)).get(path)).status).toBe(200);
      }
    });

    it("routes without contract metadata require a token (default deny)", async () => {
      expect((await request(server(app)).get("/api/v1/_test/plain")).status).toBe(401);
      const ok = await request(server(app))
        .get("/api/v1/_test/plain")
        .set("authorization", `Bearer ${await idp.sign()}`);
      expect(ok.status).toBe(200);
    });

    it("contract routes without a permission still require a token", async () => {
      expect((await request(server(app)).get("/api/v1/_test/open-contract")).status).toBe(401);
    });

    it("a trailing-slash variant of a public path is not public", async () => {
      expect((await request(server(app)).get("/api/v1/health/")).status).toBe(401);
    });
  });

  describe("/me and provisioning", () => {
    it("valid token gives 200 and creates the user", async () => {
      const res = await me(await idp.sign());
      expect(res.status).toBe(200);
      const user = await db.user.findFirstOrThrow();
      expect(res.body).toEqual({
        id: user.id,
        email: "user@example.test",
        displayName: "Test User",
        roles: [],
        permissions: ["me.read", "me.update", "organisation.read"],
        viewMode: "guided",
        theme: "system",
        modules: [],
      });
      expect(user.idpIssuer).toBe(idp.issuer);
      expect(user.idpSubject).toBe("subject-1");
      expect(user.lastSeenAt).toBeInstanceOf(Date);
    });

    describe("lastSeenAt throttling", () => {
      const T0 = new Date("2026-11-04T10:00:00Z");
      let now = T0;
      let clocked: INestApplication;
      const at = (seconds: number) => {
        now = new Date(T0.getTime() + seconds * 1000);
      };
      const meAt = async (seconds: number, claims: Record<string, unknown> = {}) => {
        at(seconds);
        const iat = Math.floor(now.getTime() / 1000);
        const token = await idp.sign({ iat, exp: iat + 3600, auth_time: iat - 10, ...claims });
        const res = await request(server(clocked))
          .get("/api/v1/me")
          .set("authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        return db.user.findFirstOrThrow();
      };

      beforeAll(async () => {
        clocked = await buildApp({
          issuer: idp.issuer,
          audience: "isms-api",
          clock: { now: () => now },
        });
      });
      afterAll(async () => {
        await clocked.close();
      });

      it("does not write lastSeenAt again within 5 minutes", async () => {
        await meAt(0);
        const user = await meAt(299);
        expect(user.lastSeenAt).toEqual(T0);
      });

      it("writes lastSeenAt again after 5 minutes", async () => {
        await meAt(0);
        const user = await meAt(300);
        expect(user.lastSeenAt).toEqual(new Date(T0.getTime() + 300_000));
      });

      it("writes a changed email or name at once and refreshes lastSeenAt", async () => {
        const first = await meAt(0);
        const user = await meAt(60, { email: "renamed@example.test", name: "Renamed" });
        expect(await db.user.count()).toBe(1);
        expect(user.id).toBe(first.id);
        expect(user.email).toBe("renamed@example.test");
        expect(user.displayName).toBe("Renamed");
        expect(user.lastSeenAt).toEqual(new Date(T0.getTime() + 60_000));
      });
    });

    it("the same subject from another issuer is a different user", async () => {
      const other = await new JwksServer().start();
      other.keys = [await makeKey("o-1")];
      const otherApp = await buildApp({ issuer: other.issuer, audience: "isms-api" });
      try {
        await me(await idp.sign());
        const res = await request(server(otherApp))
          .get("/api/v1/me")
          .set("authorization", `Bearer ${await other.sign()}`);
        expect(res.status).toBe(200);
        expect(await db.user.count()).toBe(2);
      } finally {
        await otherApp.close();
        await other.stop();
      }
    });

    describe("view mode", () => {
      const save = async (body: unknown, token?: string) =>
        request(server(app))
          .patch("/api/v1/me/preferences")
          .set("authorization", `Bearer ${token ?? (await idp.sign())}`)
          .send(body as object);
      const viewMode = async (token?: string) =>
        ((await me(token ?? (await idp.sign()))).body as { viewMode: string }).viewMode;

      it("returns the role default until the user chooses a view mode", async () => {
        expect(await viewMode()).toBe("guided");
        expect(await db.user.findFirstOrThrow()).toMatchObject({ viewMode: null });
        const adminToken = await idp.sign({ email: "boss@example.test", sub: "boss" });
        expect(await viewMode(adminToken)).toBe("professional");
      });

      it("saves the chosen view mode and returns it from /me", async () => {
        const res = await save({ viewMode: "executive" });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ viewMode: "executive", theme: "system" });
        expect(await viewMode()).toBe("executive");
        expect(await db.auditEvent.count()).toBe(0);
      });

      it("keeps the choice when roles change", async () => {
        await save({ viewMode: "guided" });
        const user = await db.user.findFirstOrThrow();
        await db.roleAssignment.create({
          data: { userId: user.id, role: "ciso", scopeType: "ORGANISATION", grantedById: user.id },
        });
        expect(await viewMode()).toBe("guided");
      });

      it.each([[{ viewMode: "loud" }], [{}], [{ viewMode: "guided", extra: 1 }]])(
        "rejects %j with VALIDATION_FAILED",
        async (body) => {
          const res = await save(body);
          expect(res.status).toBe(400);
          expect((res.body as ErrorBody).error.code).toBe("VALIDATION_FAILED");
          expect(await db.user.findFirstOrThrow()).toMatchObject({ viewMode: null });
        },
      );

      it("requires sign-in", async () => {
        const res = await request(server(app))
          .patch("/api/v1/me/preferences")
          .send({ viewMode: "guided" });
        expect(res.status).toBe(401);
      });
    });
  });

  describe("bootstrap administrator", () => {
    const bootstrapToken = (claims: Record<string, unknown> = {}) =>
      idp.sign({ email: "boss@example.TEST", sub: "boss", ...claims });

    it("grants organisation-scoped administrator to the verified matching email", async () => {
      const res = await me(await bootstrapToken());
      expect(res.status).toBe(200);
      expect((res.body as { roles: unknown }).roles).toEqual([
        { role: "administrator", scope: { type: "organisation", id: null } },
      ]);
      expect((res.body as { permissions: unknown }).permissions).toEqual([
        "me.read",
        "me.update",
        "organisation.read",
        "users.list",
        "roles.assign",
        "audit.read",
        "settings.ai.manage",
        "library.read",
        "organisation.manage",
        "risks.report",
        "ai.transcripts.read",
        "aiact.read",
      ]);
      const grant = await db.roleAssignment.findFirstOrThrow();
      expect(grant).toMatchObject({
        role: "administrator",
        scopeType: "ORGANISATION",
        siteId: null,
        departmentId: null,
      });
      // A repeat login keeps exactly one grant.
      await me(await bootstrapToken());
      expect(await admins()).toBe(1);
    });

    it("skips the bootstrap transaction once the user is an organisation administrator", async () => {
      await me(await bootstrapToken());
      const prisma = app.get<PrismaService>(PRISMA);
      const spy = vi.spyOn(prisma, "$transaction");
      try {
        const res = await me(await bootstrapToken());
        expect((res.body as { roles: unknown[] }).roles).toHaveLength(1);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("does nothing when the email is unverified", async () => {
      const res = await me(await bootstrapToken({ email_verified: false }));
      expect(res.status).toBe(200);
      expect(await admins()).toBe(0);
    });

    it("does nothing when the email does not match", async () => {
      await me(await bootstrapToken({ email: "boss@example.test.evil" }));
      await me(await bootstrapToken({ email: "other@example.test", sub: "other" }));
      expect(await admins()).toBe(0);
    });

    it("does nothing if an administrator already exists", async () => {
      await me(await idp.sign({ sub: "existing" }));
      const existing = await db.user.findFirstOrThrow();
      await db.roleAssignment.create({
        data: {
          userId: existing.id,
          role: "administrator",
          scopeType: "ORGANISATION",
          grantedById: existing.id,
        },
      });
      const res = await me(await bootstrapToken());
      expect((res.body as { roles: unknown[] }).roles).toEqual([]);
      expect(await admins()).toBe(1);
    });

    it("does nothing when BOOTSTRAP_ADMIN_EMAIL is not set", async () => {
      const unset = await buildApp({ issuer: idp.issuer, audience: "isms-api" });
      try {
        const res = await request(server(unset))
          .get("/api/v1/me")
          .set("authorization", `Bearer ${await bootstrapToken()}`);
        expect(res.status).toBe(200);
        expect(await admins()).toBe(0);
      } finally {
        await unset.close();
      }
    });

    it("is race-safe: two concurrent matching first logins yield exactly one admin", async () => {
      const service = app.get(UserProvisioningService);
      const identity = (subject: string, email: string) => ({
        issuer: idp.issuer,
        subject,
        email,
        emailVerified: true,
        name: subject,
        authTime: Math.floor(Date.now() / 1000),
        authTimeSource: "auth_time" as const,
      });
      for (let round = 0; round < 5; round++) {
        await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
        const actors = await Promise.all([
          service.resolve(identity("boss-a", "boss@example.test"), { requestId: "race-a-0001" }),
          service.resolve(identity("boss-b", "BOSS@EXAMPLE.TEST"), { requestId: "race-b-0001" }),
        ]);
        expect(await admins()).toBe(1);
        expect(await db.auditEvent.count({ where: { action: "identity.bootstrap_admin" } })).toBe(
          1,
        );
        expect(actors.filter((a) => a.roles.some((r) => r.role === "administrator"))).toHaveLength(
          1,
        );
      }
    });

    it("each bootstrap writes exactly one identity.bootstrap_admin audit row", async () => {
      const res = await request(server(app))
        .get("/api/v1/me")
        .set("authorization", `Bearer ${await bootstrapToken()}`)
        .set("x-request-id", "boot-req-0001");
      expect(res.status).toBe(200);
      // Repeat sign-ins grant nothing, so they audit nothing.
      await me(await bootstrapToken());
      const user = await db.user.findFirstOrThrow();
      const rows = await db.auditEvent.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "identity.bootstrap_admin",
        actorUserId: user.id,
        objectType: "User",
        objectId: user.id,
        beforeRef: null,
        afterRef: { role: "administrator", scope: "organisation" },
        requestId: "boot-req-0001",
      });
    });

    it("writes no audit row when nothing is granted", async () => {
      await me(await bootstrapToken({ email_verified: false }));
      await me(await idp.sign());
      expect(await db.auditEvent.count()).toBe(0);
    });

    it("rolls back the grant if the audit write fails", async () => {
      const audit = app.get(AuditService);
      const spy = vi.spyOn(audit, "record").mockRejectedValueOnce(new Error("audit down"));
      try {
        const res = await me(await bootstrapToken());
        expect(res.status).toBe(500);
        expect(await admins()).toBe(0);
        expect(await db.auditEvent.count()).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
