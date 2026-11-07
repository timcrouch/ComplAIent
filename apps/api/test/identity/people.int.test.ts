import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import type { RoleAssignmentDetailDto, UserSummaryDto } from "@isms/contracts";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../src/audit/index.js";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { BOOTSTRAP_ADMIN_LOCK, IdentityModule } from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { SystemModule } from "../../src/system/index.js";
import { JwksServer, makeKey } from "./jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const UNKNOWN_ID = "0190a4b8-6f1e-7c3a-9b2d-4e5f6a7b8c9d";
const anyString: unknown = expect.any(String);

const NAMES: Record<string, string> = {
  admin: "Alma Admin",
  bob: "Bruno Brandt",
  carol: "Carla Ciso",
  dave: "Dace Dzene",
};

type ErrorBody = {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
};

describe("users and role assignments", () => {
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
        IdentityModule.forRoot({
          issuer: idp.issuer,
          audience: "isms-api",
          bootstrapAdminEmail: "admin@example.test",
        }),
        AuthorizationModule.forRoot(),
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

  /** A token for a dev user; auth_time is `authAge` seconds ago (default: just signed in). */
  const token = (sub: string, authAge = 0) => {
    const now = Math.floor(Date.now() / 1000);
    return idp.sign({
      sub,
      email: `${sub}@example.test`,
      name: NAMES[sub] ?? sub,
      iat: now,
      exp: now + 300,
      auth_time: now - authAge,
    });
  };

  /** Provisions a user by signing in (admin becomes the bootstrap administrator). */
  const signIn = async (sub: string): Promise<string> => {
    const res = await request(server())
      .get("/api/v1/me")
      .set("authorization", `Bearer ${await token(sub)}`);
    expect(res.status).toBe(200);
    return (res.body as { id: string }).id;
  };

  const listUsers = async (sub = "admin") =>
    request(server())
      .get("/api/v1/users")
      .set("authorization", `Bearer ${await token(sub)}`);

  const grant = async (userId: string, body: unknown, sub = "admin", authAge = 0) =>
    request(server())
      .post(`/api/v1/users/${userId}/roles`)
      .set("authorization", `Bearer ${await token(sub, authAge)}`)
      .send(body as object);

  const revoke = async (assignmentId: string, sub = "admin", authAge = 0) =>
    request(server())
      .delete(`/api/v1/role-assignments/${assignmentId}`)
      .set("authorization", `Bearer ${await token(sub, authAge)}`);

  const ORG = { type: "organisation", id: null } as const;
  const site = (name = "Riga plant") =>
    db.site.create({
      data: { name, nameKey: name.toLowerCase(), countryCode: "LV" },
      select: { id: true },
    });
  const orgAdminCount = () =>
    db.roleAssignment.count({ where: { role: "administrator", scopeType: "ORGANISATION" } });
  const adminAssignmentOf = async (userId: string) =>
    (
      await db.roleAssignment.findFirstOrThrow({
        where: { userId, role: "administrator", scopeType: "ORGANISATION" },
        select: { id: true },
      })
    ).id;
  const audits = (action: string) =>
    db.auditEvent.findMany({ where: { action }, orderBy: { occurredAt: "asc" } });
  const conflictPath = (res: { body: unknown }) => (res.body as ErrorBody).error.details?.[0]?.path;

  it("lists users who have signed in, with their roles and scope names", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    const { id: rigaId } = await site();
    expect((await grant(bobId, { role: "ciso", scope: { type: "site", id: rigaId } })).status).toBe(
      201,
    );

    const res = await listUsers();
    expect(res.status).toBe(200);
    const users = (res.body as { users: UserSummaryDto[] }).users;
    expect(users.map((u) => u.displayName)).toEqual(["Alma Admin", "Bruno Brandt"]);
    expect(users[0]).toEqual({
      id: adminId,
      email: "admin@example.test",
      displayName: "Alma Admin",
      lastSeenAt: anyString,
      roles: [
        {
          id: anyString,
          userId: adminId,
          role: "administrator",
          scope: { type: "organisation", id: null },
          scopeName: null,
          createdAt: anyString,
        },
      ],
    });
    expect(users[1]?.roles).toEqual([
      expect.objectContaining({
        userId: bobId,
        role: "ciso",
        scope: { type: "site", id: rigaId },
        scopeName: "Riga plant",
      }),
    ]);
  });

  it("grants an organisation role and audits it in the same transaction", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    const res = await grant(bobId, { role: "auditor", scope: ORG });
    expect(res.status).toBe(201);
    const dto = res.body as RoleAssignmentDetailDto;
    expect(dto).toEqual({
      id: anyString,
      userId: bobId,
      role: "auditor",
      scope: { type: "organisation", id: null },
      scopeName: null,
      createdAt: anyString,
    });
    const stored = await db.roleAssignment.findUniqueOrThrow({ where: { id: dto.id } });
    expect(stored.grantedById).toBe(adminId);

    const [event, ...more] = await audits("identity.role_granted");
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      actorUserId: adminId,
      objectType: "RoleAssignment",
      objectId: dto.id,
      requestId: res.headers["x-request-id"],
      afterRef: { userId: bobId, role: "auditor", scopeType: "organisation", scopeId: null },
    });

    // The audit row is written in the grant's transaction: if it fails, nothing is granted.
    const spy = vi
      .spyOn(app.get(AuditService), "record")
      .mockRejectedValueOnce(new Error("audit down"));
    try {
      expect((await grant(bobId, { role: "viewer", scope: ORG })).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await db.roleAssignment.count({ where: { userId: bobId, role: "viewer" } })).toBe(0);
  });

  it("grants a site-scoped role", async () => {
    await signIn("admin");
    const bobId = await signIn("bob");
    const { id: rigaId } = await site();
    const res = await grant(bobId, { role: "risk_owner", scope: { type: "site", id: rigaId } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scope: { type: "site", id: rigaId },
      scopeName: "Riga plant",
    });
    const [event] = await audits("identity.role_granted");
    expect(event?.afterRef).toEqual({
      userId: bobId,
      role: "risk_owner",
      scopeType: "site",
      scopeId: rigaId,
    });
  });

  it("rejects a scope that does not exist with VALIDATION_FAILED on scope.id", async () => {
    await signIn("admin");
    const bobId = await signIn("bob");
    for (const type of ["site", "department"] as const) {
      const res = await grant(bobId, { role: "viewer", scope: { type, id: UNKNOWN_ID } });
      expect(res.status).toBe(400);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.details?.map((d) => d.path)).toEqual(["scope.id"]);
    }
    expect(await db.roleAssignment.count({ where: { userId: bobId } })).toBe(0);
    expect(await audits("identity.role_granted")).toEqual([]);
  });

  it("gives 404 for an unknown user or assignment", async () => {
    await signIn("admin");
    const unknownUser = await grant(UNKNOWN_ID, { role: "viewer", scope: ORG });
    expect(unknownUser.status).toBe(404);
    expect((unknownUser.body as ErrorBody).error.code).toBe("NOT_FOUND");
    const unknownAssignment = await revoke(UNKNOWN_ID);
    expect(unknownAssignment.status).toBe(404);
    expect((unknownAssignment.body as ErrorBody).error.code).toBe("NOT_FOUND");
  });

  it("refuses a duplicate assignment with 409 duplicateRoleAssignment", async () => {
    await signIn("admin");
    const bobId = await signIn("bob");
    const { id: rigaId } = await site();
    for (const scope of [ORG, { type: "site", id: rigaId }]) {
      expect((await grant(bobId, { role: "viewer", scope })).status).toBe(201);
      const again = await grant(bobId, { role: "viewer", scope });
      expect(again.status).toBe(409);
      expect((again.body as ErrorBody).error.code).toBe("CONFLICT");
      expect(conflictPath(again)).toBe("duplicateRoleAssignment");
    }
    expect(await db.roleAssignment.count({ where: { userId: bobId } })).toBe(2);
    expect(await audits("identity.role_granted")).toHaveLength(2);
  });

  it("revokes an assignment and audits the removal", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    const { id: rigaId } = await site();
    const granted = (await grant(bobId, { role: "ciso", scope: { type: "site", id: rigaId } }))
      .body as RoleAssignmentDetailDto;

    const res = await revoke(granted.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(granted);
    expect(await db.roleAssignment.count({ where: { id: granted.id } })).toBe(0);
    const [event, ...more] = await audits("identity.role_revoked");
    expect(more).toEqual([]);
    expect(event).toMatchObject({
      actorUserId: adminId,
      objectType: "RoleAssignment",
      objectId: granted.id,
      requestId: res.headers["x-request-id"],
      beforeRef: { userId: bobId, role: "ciso", scopeType: "site", scopeId: rigaId },
    });
    expect(event?.afterRef).toBeNull();
    expect((await revoke(granted.id)).status).toBe(404);
  });

  it("refuses to remove the last organisation administrator, including oneself", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    const { id: rigaId } = await site();
    // A site-scoped administrator does not count as an organisation administrator.
    expect(
      (await grant(bobId, { role: "administrator", scope: { type: "site", id: rigaId } })).status,
    ).toBe(201);

    const res = await revoke(await adminAssignmentOf(adminId));
    expect(res.status).toBe(409);
    const body = res.body as ErrorBody;
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details?.[0]?.path).toBe("lastAdministrator");
    expect(await orgAdminCount()).toBe(1);
    expect(await audits("identity.role_revoked")).toEqual([]);

    // With a second organisation administrator, self-removal is allowed.
    expect((await grant(bobId, { role: "administrator", scope: ORG })).status).toBe(201);
    expect((await revoke(await adminAssignmentOf(adminId))).status).toBe(200);
    expect(await orgAdminCount()).toBe(1);
  });

  it("two administrators revoking each other at once leave exactly one", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    expect((await grant(bobId, { role: "administrator", scope: ORG })).status).toBe(201);
    const adminAssignment = await adminAssignmentOf(adminId);
    const bobAssignment = await adminAssignmentOf(bobId);

    // Deterministic interleaving: hold the lock, start both revokes, wait until both are
    // blocked on it (so both have begun before either has checked), then release. A revoke
    // that did not take the lock would never block here and the wait would time out.
    let pending: Promise<Awaited<ReturnType<typeof revoke>>[]> | undefined;
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_ADMIN_LOCK}))`;
        pending = Promise.all([revoke(bobAssignment, "admin"), revoke(adminAssignment, "bob")]);
        await vi.waitFor(
          async () => {
            const [row] = await db.$queryRaw<{ n: bigint }[]>`
              SELECT count(*) AS n FROM pg_locks
              WHERE locktype = 'advisory' AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
            expect(Number(row?.n)).toBe(2);
          },
          { timeout: 10_000, interval: 25 },
        );
      },
      { timeout: 15_000 },
    );
    // Committing released the lock; the two revokes now run one after the other.
    if (!pending) throw new Error("revokes were not started");
    const results = await pending;

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.status === 409);
    expect(refused && conflictPath(refused)).toBe("lastAdministrator");
    expect(await orgAdminCount()).toBe(1);
    expect(await audits("identity.role_revoked")).toHaveLength(1);
  });

  it("requires a recent sign-in: auth_time 301 s old gives RECENT_AUTH_REQUIRED", async () => {
    const adminId = await signIn("admin");
    const bobId = await signIn("bob");
    const stale = await grant(bobId, { role: "viewer", scope: ORG }, "admin", 301);
    expect(stale.status).toBe(403);
    expect((stale.body as ErrorBody).error.code).toBe("RECENT_AUTH_REQUIRED");
    const staleRevoke = await revoke(await adminAssignmentOf(adminId), "admin", 301);
    expect((staleRevoke.body as ErrorBody).error.code).toBe("RECENT_AUTH_REQUIRED");
    // Listing is not sensitive.
    const now = Math.floor(Date.now() / 1000);
    const oldSignIn = await idp.sign({
      sub: "admin",
      email: "admin@example.test",
      name: NAMES["admin"],
      auth_time: now - 3600,
    });
    expect(
      (await request(server()).get("/api/v1/users").set("authorization", `Bearer ${oldSignIn}`))
        .status,
    ).toBe(200);
    expect(await db.roleAssignment.count({ where: { userId: bobId } })).toBe(0);
  });

  it("a CISO can list users but cannot grant roles", async () => {
    await signIn("admin");
    const carolId = await signIn("carol");
    const daveId = await signIn("dave");
    expect((await grant(carolId, { role: "ciso", scope: ORG })).status).toBe(201);
    expect((await listUsers("carol")).status).toBe(200);
    const res = await grant(daveId, { role: "viewer", scope: ORG }, "carol");
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    const users = await listUsers("dave");
    expect(users.status).toBe(403);
  });
});
