import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AiProvider, AiSettingsRow } from "@isms/ai";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import type { DestinationStream } from "pino";
import request from "supertest";
import { z } from "zod";
import { AiModule } from "../../src/ai/index.js";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));

/** Owner connection: sees and changes everything, bypassing the app role's grants. */
export const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

export const KEY = "sk-or-v1-" + "a".repeat(40) + "WXYZ";
export const OTHER_KEY = "sk-or-v1-" + "b".repeat(40) + "QRST";

export const USERS = {
  admin: { name: "Anna Admin", role: "administrator" },
  carla: { name: "Carla Ciso", role: "ciso" },
} as const;
export type Who = keyof typeof USERS;

export type ErrorBody = {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
};

export const detailPaths = (res: { body: unknown }): string[] =>
  ((res.body as ErrorBody).error.details ?? []).map((d) => d.path);

export const newSecretsKey = (): Buffer => randomBytes(32);

export type AiHarnessOptions = {
  /** Omit to build an app without AI_SECRETS_KEY. */
  secretsKey?: Buffer;
  /** The gateway's test seam; the default is the mock provider. */
  providerFactory?: (settings: AiSettingsRow, apiKey: string) => AiProvider;
  /** AI_ALLOW_NON_EU_ROUTING: development-only opt-in to EU-only routing being off. */
  allowNonEuRouting?: boolean;
  logLevel?: string;
  logDestination?: DestinationStream;
  /** Signs in through another harness's issuer, so its users (and their roles) apply. */
  sharedIdp?: () => JwksServer;
};

type Send = { who?: Who; authAge?: number };

/** An API app with the AI settings routes, signed in through a local JWKS issuer. */
export function aiHarness(options: AiHarnessOptions) {
  let idp: JwksServer;
  let app: INestApplication;
  const userIds = {} as Record<Who, string>;
  const server = (): Server => app.getHttpServer() as Server;

  /** A token whose auth_time is `authAge` seconds ago (default: just signed in). */
  const token = (who: Who, authAge = 0) => {
    const now = Math.floor(Date.now() / 1000);
    return idp.sign({
      sub: who,
      email: `${who}@example.test`,
      name: USERS[who].name,
      iat: now,
      exp: now + 300,
      auth_time: now - authAge,
    });
  };

  const call = async (
    method: "get" | "put" | "patch" | "post" | "delete",
    path: string,
    body: unknown,
    { who = "admin", authAge = 0 }: Send,
  ) => {
    const agent = request(server());
    const req = agent[method](path).set("authorization", `Bearer ${await token(who, authAge)}`);
    return body === undefined ? req : req.send(body as object);
  };

  return {
    userIds,
    app: () => app,
    idp: () => idp,
    async start(): Promise<void> {
      if (options.sharedIdp) idp = options.sharedIdp();
      else {
        idp = await new JwksServer().start();
        idp.keys = [await makeKey("key-1")];
      }
      const moduleRef = await Test.createTestingModule({
        imports: [
          PlatformModule.forRoot({
            logLevel: options.logLevel ?? "silent",
            service: "isms-api-test",
            rateLimitPerMinute: 1000,
            rateLimitPerIpPerMinute: 1000,
            throttleTrustedIps: [],
            ...(options.logDestination ? { logDestination: options.logDestination } : {}),
          }),
          InfrastructureModule.forRoot({
            databaseUrl: env.DATABASE_TEST_URL,
            redisUrl: env.REDIS_URL,
          }),
          IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api" }),
          AuthorizationModule.forRoot(),
          AiModule.forRoot({
            secretsKey: options.secretsKey,
            provider: "mock",
            ...(options.allowNonEuRouting ? { allowNonEuRouting: true } : {}),
            ...(options.providerFactory ? { providerFactory: options.providerFactory } : {}),
          }),
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
          data: { userId: user.id, role: u.role, scopeType: "ORGANISATION", grantedById: user.id },
        });
      }
    },
    async stop(): Promise<void> {
      await app.close();
      if (!options.sharedIdp) await idp.stop();
    },
    get: (path: string, send: Send = {}) => call("get", path, undefined, send),
    put: (path: string, body: unknown, send: Send = {}) => call("put", path, body, send),
    patch: (path: string, body: unknown, send: Send = {}) => call("patch", path, body, send),
    post: (path: string, send: Send = {}) => call("post", path, undefined, send),
    delete: (path: string, send: Send = {}) => call("delete", path, undefined, send),
  };
}

/** Audit rows with an `ai.` action, oldest first. */
export const aiAudits = () =>
  db.auditEvent.findMany({
    where: { action: { startsWith: "ai." } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
