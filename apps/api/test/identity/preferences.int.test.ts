import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { JwksServer, makeKey } from "./jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

type ErrorBody = { error: { code: string; message: string; requestId: string } };

/** The colour theme is a per-user preference (#2); view mode is covered in me.int.test.ts. */
describe("preferences: theme", () => {
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
        IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api" }),
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

  const me = (token: string) =>
    request(server()).get("/api/v1/me").set("authorization", `Bearer ${token}`);

  describe("theme (#2)", () => {
    const save = async (body: unknown, token?: string) =>
      request(server())
        .patch("/api/v1/me/preferences")
        .set("authorization", `Bearer ${token ?? (await idp.sign())}`)
        .send(body as object);
    const prefs = async (token?: string) =>
      (await me(token ?? (await idp.sign()))).body as { viewMode: string; theme: string };

    it("is system until the user chooses one", async () => {
      expect((await prefs()).theme).toBe("system");
      expect(await db.user.findFirstOrThrow()).toMatchObject({ theme: null });
    });

    it("saves the chosen theme on the account without touching the view mode", async () => {
      const res = await save({ theme: "dark" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ viewMode: "guided", theme: "dark" });
      expect(await prefs()).toMatchObject({ viewMode: "guided", theme: "dark" });
      expect(await db.user.findFirstOrThrow()).toMatchObject({ theme: "dark", viewMode: null });
      expect(await db.auditEvent.count()).toBe(0);
    });

    it("saves the view mode without touching the theme", async () => {
      await save({ theme: "light" });
      expect((await save({ viewMode: "executive" })).body).toEqual({
        viewMode: "executive",
        theme: "light",
      });
    });

    it("belongs to each user: another user keeps their own theme", async () => {
      await save({ theme: "dark" });
      const other = await idp.sign({ email: "other@example.test", sub: "other" });
      expect((await prefs(other)).theme).toBe("system");
      await save({ theme: "light" }, other);
      expect((await prefs()).theme).toBe("dark");
      expect((await prefs(other)).theme).toBe("light");
    });

    it.each([[{ theme: "neon" }], [{ theme: "dark", extra: 1 }]])(
      "rejects %j with VALIDATION_FAILED",
      async (body) => {
        const res = await save(body);
        expect(res.status).toBe(400);
        expect((res.body as ErrorBody).error.code).toBe("VALIDATION_FAILED");
        expect(await db.user.findFirstOrThrow()).toMatchObject({ theme: null });
      },
    );
  });
});
