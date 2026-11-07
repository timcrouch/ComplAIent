import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, oidcConfig, webConfig } from "@isms/config";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { keycloakAccessToken } from "./keycloak-login.js";

// Smoke check against the real local Keycloak from the compose environment (pnpm infra:up).
const env = loadConfig(
  z.object({
    ...databaseTestConfig.shape,
    ...oidcConfig.shape,
    WEB_BASE_URL: webConfig.shape.WEB_BASE_URL,
    REDIS_URL: z.string(),
    DEV_USER_PASSWORD: z.string().min(1),
  }),
);

describe("real Keycloak smoke", () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
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
        IdentityModule.forRoot({ issuer: env.OIDC_ISSUER_URL, audience: env.OIDC_AUDIENCE }),
        AuthorizationModule.forRoot(),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, { trustProxy: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("a Keycloak access token for reporter@example.test reaches /me", async () => {
    const token = await keycloakAccessToken({
      issuer: env.OIDC_ISSUER_URL,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      redirectUri: `${env.WEB_BASE_URL}/auth/callback`,
      username: "reporter@example.test",
      password: env.DEV_USER_PASSWORD,
    });
    const res = await request(app.getHttpServer() as Server)
      .get("/api/v1/me")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: "reporter@example.test",
      displayName: "Rita Reporter",
      roles: [],
      permissions: ["me.read", "me.update", "organisation.read"],
      viewMode: "guided",
    });
  });
});
