import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { assertTestDatabaseUrl, resetTestDatabase } from "@isms/database/testing";
import type { DemoPorts } from "@isms/demo";
import request from "supertest";
import { z } from "zod";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { DEMO_PORTS, DemoModule } from "../../src/demo/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
assertTestDatabaseUrl(env.DATABASE_OWNER_TEST_URL);

/** Owner connection to the test database: sees and changes everything. */
export const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

export const BOOTSTRAP_EMAIL = "boss@bank.test";

/** Who signs in: subject, email and the role seeded for them (null: none). */
export const PEOPLE = {
  admin: { sub: "kc-anna", email: "anna@example.test", name: "Anna Admin", role: "administrator" },
  rita: { sub: "kc-rita", email: "rita@example.test", name: "Rita Reporter", role: "contributor" },
  // The loader of Review Focus 1: neither the bootstrap admin nor an @example.test address.
  loader: {
    sub: "kc-7f3e-loader",
    email: "loader@corp.example",
    name: "Lena Loader",
    role: "administrator",
  },
} as const;
export type Who = keyof typeof PEOPLE;

export type ErrorBody = {
  error: { code: string; message: string; details?: { path: string; message: string }[] };
};

export const detailPaths = (res: { body: unknown }): string[] =>
  ((res.body as ErrorBody).error.details ?? []).map((d) => d.path);

/** Ports that touch nothing outside the database and record what was asked. */
export function fakePorts() {
  const calls: string[] = [];
  const record =
    <T>(name: string, value: T) =>
    () => {
      calls.push(name);
      return Promise.resolve(value);
    };
  const ports: DemoPorts = {
    wipeEvidence: record("wipeEvidence", 0),
    putEvidence: record("putEvidence", undefined),
    wipeSessions: record("wipeSessions", 0),
    drainQueues: record("drainQueues", undefined),
    enqueueLibraryEmbed: record("enqueueLibraryEmbed", undefined),
  };
  return { ports, calls };
}

/**
 * An API app with identity, authorization and the demo module, signed in through a local
 * JWKS issuer. `demo: false` builds the same app with demo mode off.
 */
export function demoHarness(opts: { demo: boolean }) {
  let idp: JwksServer;
  let app: INestApplication;
  const fake = fakePorts();
  const server = (): Server => app.getHttpServer() as Server;

  const token = (who: Who, claims: Record<string, unknown> = {}) => {
    const p = PEOPLE[who];
    return idp.sign({ sub: p.sub, email: p.email, name: p.name, ...claims });
  };

  return {
    fake,
    get app() {
      return app;
    },
    token,
    async start(): Promise<void> {
      idp = await new JwksServer().start();
      idp.keys = [await makeKey("key-1")];
      const builder = Test.createTestingModule({
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
          IdentityModule.forRoot({
            issuer: idp.issuer,
            audience: "isms-api",
            bootstrapAdminEmail: BOOTSTRAP_EMAIL,
            demoTools: opts.demo,
          }),
          AuthorizationModule.forRoot(),
          DemoModule.register(
            opts.demo
              ? {
                  ownerUrl: env.DATABASE_OWNER_TEST_URL,
                  bootstrapAdminEmail: BOOTSTRAP_EMAIL,
                  // Unused: DEMO_PORTS is replaced below.
                  storage: {
                    S3_ENDPOINT: "http://127.0.0.1:1",
                    S3_REGION: "eu-central-1",
                    S3_BUCKET: "unused",
                    S3_ACCESS_KEY_ID: "unused",
                    S3_SECRET_ACCESS_KEY: "unused",
                    S3_FORCE_PATH_STYLE: true,
                  },
                  redisUrl: env.REDIS_URL,
                }
              : null,
          ),
        ],
      });
      if (opts.demo) builder.overrideProvider(DEMO_PORTS).useValue(fake.ports);
      const moduleRef = await builder.compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      configureApp(app, { trustProxy: false });
      await app.init();
    },
    /** Empty test database with the three people signed in before, holding their roles. */
    async reset(): Promise<void> {
      await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
      fake.calls.length = 0;
      for (const p of Object.values(PEOPLE)) {
        const user = await db.user.create({
          data: { idpIssuer: idp.issuer, idpSubject: p.sub, email: p.email, displayName: p.name },
        });
        await db.roleAssignment.create({
          data: { userId: user.id, role: p.role, scopeType: "ORGANISATION", grantedById: user.id },
        });
      }
    },
    async stop(): Promise<void> {
      await app.close();
      await idp.stop();
    },
    async get(path: string, who: Who = "admin", claims: Record<string, unknown> = {}) {
      return request(server())
        .get(path)
        .set("authorization", `Bearer ${await token(who, claims)}`);
    },
    async post(
      path: string,
      body: unknown,
      who: Who = "admin",
      claims: Record<string, unknown> = {},
    ) {
      return request(server())
        .post(path)
        .set("authorization", `Bearer ${await token(who, claims)}`)
        .send(body as object);
    },
    /** A request with no token at all. */
    anonymous(method: "get" | "post", path: string) {
      return request(server())[method](path);
    },
  };
}
