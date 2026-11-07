import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { vi } from "vitest";
import { z } from "zod";
import { AiModule } from "../../src/ai/index.js";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { OrganisationModule, SETUP_LOCK } from "../../src/organisation/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));

/** Owner connection: sees and changes everything, bypassing the app role's grants. */
export const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

export const USERS = {
  admin: { name: "Anna Admin", role: "administrator" },
  rita: { name: "Rita Reporter", role: "contributor" },
} as const;
export type Who = keyof typeof USERS;

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
};

export const detailPaths = (res: { body: unknown }): string[] =>
  ((res.body as ErrorBody).error.details ?? []).map((d) => d.path);

/** An API app with organisation setup, signed in through a local JWKS issuer. */
export function organisationHarness() {
  let idp: JwksServer;
  let app: INestApplication;
  const userIds = {} as Record<Who, string>;
  const server = (): Server => app.getHttpServer() as Server;

  const token = (who: Who) => {
    const now = Math.floor(Date.now() / 1000);
    return idp.sign({
      sub: who,
      email: `${who}@example.test`,
      name: USERS[who].name,
      iat: now,
      exp: now + 300,
      auth_time: now,
    });
  };

  return {
    userIds,
    async start(): Promise<void> {
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
          IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api" }),
          AuthorizationModule.forRoot(),
          OrganisationModule,
          // Framework suggestions need the AI gateway; AI is off here (no settings row).
          AiModule.forRoot({ secretsKey: randomBytes(32), provider: "mock" }),
        ],
      }).compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      configureApp(app, { trustProxy: false });
      await app.init();
    },
    async reset(): Promise<void> {
      await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
      for (const [sub, u] of Object.entries(USERS) as [Who, (typeof USERS)[Who]][]) {
        const user = await db.user.create({
          data: {
            idpIssuer: idp.issuer,
            idpSubject: sub,
            email: `${sub}@example.test`,
            displayName: u.name,
          },
        });
        userIds[sub] = user.id;
        await db.roleAssignment.create({
          data: {
            userId: user.id,
            role: u.role,
            scopeType: "ORGANISATION",
            grantedById: user.id,
          },
        });
      }
    },
    async stop(): Promise<void> {
      await app.close();
      await idp.stop();
      await db.$disconnect();
    },
    async get(path: string, who: Who = "admin") {
      return request(server())
        .get(path)
        .set("authorization", `Bearer ${await token(who)}`);
    },
    async put(path: string, body: unknown, who: Who = "admin") {
      return request(server())
        .put(path)
        .set("authorization", `Bearer ${await token(who)}`)
        .send(body as object);
    },
    async post(path: string, who: Who = "admin") {
      return request(server())
        .post(path)
        .set("authorization", `Bearer ${await token(who)}`);
    },
  };
}

/**
 * Audit rows with this action, oldest first. Rows of one save share `occurredAt` (the
 * transaction's start time), so the time-ordered uuid v7 id breaks the tie.
 */
export const audits = (action: string) =>
  db.auditEvent.findMany({
    where: { action },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

/**
 * Deterministic interleaving: holds the setup lock, starts the requests, waits until both
 * are blocked on it (so both began before either wrote), then releases it. A request that did
 * not take the lock would never block, and the wait would time out.
 */
export async function raceUnderSetupLock<T>(start: () => Promise<T>[]): Promise<T[]> {
  let pending: Promise<T[]> | undefined;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK}))`;
      const started = start();
      pending = Promise.all(started);
      await vi.waitFor(
        async () => {
          const [row] = await db.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
          if (Number(row?.n) !== started.length) throw new Error("requests not blocked yet");
        },
        { timeout: 10_000, interval: 25 },
      );
    },
    { timeout: 15_000 },
  );
  if (!pending) throw new Error("requests were not started");
  return pending;
}
