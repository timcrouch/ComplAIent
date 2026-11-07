import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { DynamicModule, INestApplication, Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import type { Clock } from "@isms/domain";
import type { JobsClient } from "@isms/jobs";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { AiModule } from "../../src/ai/index.js";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { CLOCK, IdentityModule } from "../../src/identity/index.js";
import { OrganisationModule } from "../../src/organisation/index.js";
import {
  InfrastructureModule,
  PlatformModule,
  type UploadLimits,
  configureApp,
} from "../../src/platform/index.js";
import { RisksModule } from "../../src/risks/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));

/** Owner connection: sees and changes everything, bypassing the app role's grants. */
export const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

type Role =
  "administrator" | "ciso" | "risk_owner" | "risk_approver" | "contributor" | "viewer" | "auditor";

/** Each user's single role and where it applies: the organisation, site A or site B. */
export const USERS = {
  admin: { name: "Anna Admin", role: "administrator", scope: "org" },
  rita: { name: "Rita Reporter", role: "contributor", scope: "org" },
  carl: { name: "Carl Contributor", role: "contributor", scope: "org" },
  cora: { name: "Cora Ciso", role: "ciso", scope: "org" },
  oscar: { name: "Oscar Owner", role: "risk_owner", scope: "siteA" },
  olga: { name: "Olga Owner", role: "risk_owner", scope: "siteB" },
  vera: { name: "Vera Viewer", role: "viewer", scope: "org" },
  aldo: { name: "Aldo Auditor", role: "auditor", scope: "org" },
  april: { name: "April Approver", role: "risk_approver", scope: "org" },
  sam: { name: "Sam Site", role: "contributor", scope: "siteA" },
} as const satisfies Record<string, { name: string; role: Role; scope: "org" | "siteA" | "siteB" }>;
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

/** An API app with the risk routes, signed in through a local JWKS issuer. */
export function risksHarness(
  options: {
    imports?: (DynamicModule | Type)[];
    jobsPrefix?: string;
    jobs?: () => JobsClient;
    /** Raw-body limits for upload routes (configureApp). */
    uploadLimits?: UploadLimits;
    /** Replaces the services' CLOCK (token checks keep the real time). */
    clock?: Clock;
  } = {},
) {
  let idp: JwksServer;
  let app: INestApplication;
  const userIds = {} as Record<Who, string>;
  const sites = { siteA: "", siteB: "" };
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
  const auth = async (who: Who) => `Bearer ${await token(who)}`;

  return {
    userIds,
    sites,
    async start(): Promise<void> {
      idp = await new JwksServer().start();
      idp.keys = [await makeKey("key-1")];
      const builder = Test.createTestingModule({
        imports: [
          PlatformModule.forRoot({
            logLevel: "silent",
            service: "isms-api-test",
            rateLimitPerMinute: 10_000,
            rateLimitPerIpPerMinute: 10_000,
            throttleTrustedIps: [],
          }),
          InfrastructureModule.forRoot({
            databaseUrl: env.DATABASE_TEST_URL,
            redisUrl: env.REDIS_URL,
            ...(options.jobsPrefix === undefined ? {} : { jobsPrefix: options.jobsPrefix }),
            ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
          }),
          IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api" }),
          AuthorizationModule.forRoot(),
          OrganisationModule,
          RisksModule,
          // The risk controls service needs the AI gateway; a test that scripts its own wins.
          ...(options.imports?.some((m) => "module" in m && m.module === AiModule)
            ? []
            : [
                AiModule.forRoot({
                  secretsKey: randomBytes(32),
                  provider: "mock",
                }),
              ]),
          ...(options.imports ?? []),
        ],
      });
      const moduleRef = await (
        options.clock === undefined
          ? builder
          : builder.overrideProvider(CLOCK).useValue(options.clock)
      ).compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      configureApp(app, {
        trustProxy: false,
        ...(options.uploadLimits === undefined ? {} : { uploadLimits: options.uploadLimits }),
      });
      await app.init();
    },
    async reset(): Promise<void> {
      await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
      sites.siteA = (
        await db.site.create({
          data: { name: "Riga", nameKey: "riga", countryCode: "LV" },
        })
      ).id;
      sites.siteB = (
        await db.site.create({
          data: { name: "Berlin", nameKey: "berlin", countryCode: "DE" },
        })
      ).id;
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
            grantedById: user.id,
            ...(u.scope === "org"
              ? { scopeType: "ORGANISATION" }
              : { scopeType: "SITE", siteId: sites[u.scope] }),
          },
        });
      }
    },
    /** The HTTP server and a bearer header, for requests the helpers below do not cover. */
    server,
    auth,
    /** A provider of the running app, for calling services directly. */
    service<T>(token: new (...args: never[]) => T): T {
      return app.get(token);
    },
    async stop(): Promise<void> {
      await app.close();
      await idp.stop();
      await db.$disconnect();
    },
    async get(path: string, who: Who) {
      return request(server())
        .get(path)
        .set("authorization", await auth(who));
    },
    async post(path: string, body: unknown, who: Who) {
      return request(server())
        .post(path)
        .set("authorization", await auth(who))
        .send(body as object);
    },
    async delete(path: string, body: unknown, who: Who) {
      return request(server())
        .delete(path)
        .set("authorization", await auth(who))
        .send(body as object);
    },
    async patch(path: string, body: unknown, who: Who) {
      return request(server())
        .patch(path)
        .set("authorization", await auth(who))
        .send(body as object);
    },
  };
}

/** Audit rows with this action, oldest first (uuid v7 ids break ties of one transaction). */
export const audits = (action: string) =>
  db.auditEvent.findMany({
    where: { action },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

/** A complete manual report; override any field. */
export function reportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Laptop left on the train",
    scenario: "A staff laptop with customer files was left on a train.",
    threat: "Loss or theft of a device",
    consequence: "Customer data could be read by a stranger.",
    existingSafeguards: "",
    assets: [{ name: "Staff laptops", type: "device" }],
    siteId: null,
    departmentId: null,
    toConfirm: [],
    ...overrides,
  };
}
