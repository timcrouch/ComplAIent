import type { Server } from "node:http";
import { Body, Controller, Get, type INestApplication, Module, Query } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { defineRoute } from "@isms/contracts";
import { z } from "zod";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ContractRoute,
  InfrastructureModule,
  PlatformModule,
  configureApp,
} from "../src/platform/index.js";
import { REDIS_HEALTH, SystemModule } from "../src/system/index.js";

const testRoutes = {
  create: defineRoute({
    method: "post",
    path: "/api/v1/_test/items/{id}",
    summary: "test only",
    request: {
      params: z.object({ id: z.string().regex(/^\d+$/) }),
      query: z.object({ page: z.coerce.number().int().default(1) }),
      body: z.object({ n: z.number() }),
    },
    responses: { 201: z.object({ n: z.number(), page: z.number() }) },
  }),
  badResponse: defineRoute({
    method: "get",
    path: "/api/v1/_test/bad-response",
    summary: "test only",
    responses: { 200: z.object({ n: z.number() }) },
  }),
};

@Controller()
class TestController {
  @ContractRoute(testRoutes.create)
  create(
    @Body() body: { n: number },
    @Query() query: { page: number },
  ): { n: number; page: number } {
    return { n: body.n, page: query.page };
  }

  @ContractRoute(testRoutes.badResponse)
  badResponse(): unknown {
    return { n: "not-a-number" };
  }

  @Get("/api/v1/_test/ping")
  ping(): { ok: true } {
    return { ok: true };
  }

  @Get("/api/v1/_test/pong")
  pong(): { ok: true } {
    return { ok: true };
  }

  @Get("/api/v1/_test/boom")
  boom(): never {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432 secret-internal-detail");
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

const server = (app: INestApplication): Server => app.getHttpServer() as Server;

const failingRedis = {
  name: "redis",
  check: () => Promise.reject(new Error("redis down")),
};

type BuildOptions = {
  overrideRedis?: boolean;
  rateLimitPerMinute?: number;
  rateLimitPerIpPerMinute?: number;
  throttleTrustedIps?: string[];
  trustProxy?: false | number;
};

async function buildApp(options: BuildOptions = {}): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [
      PlatformModule.forRoot({
        logLevel: "silent",
        service: "isms-api-test",
        rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
        rateLimitPerIpPerMinute: options.rateLimitPerIpPerMinute ?? 1000,
        throttleTrustedIps: options.throttleTrustedIps ?? [],
      }),
      InfrastructureModule.forRoot({
        databaseUrl: process.env["DATABASE_TEST_URL"] ?? "",
        redisUrl: process.env["REDIS_URL"] ?? "",
      }),
      SystemModule,
      TestModule,
    ],
  });
  if (options.overrideRedis) builder.overrideProvider(REDIS_HEALTH).useValue(failingRedis);
  const app = (await builder.compile()).createNestApplication({ bufferLogs: true });
  configureApp(app, { trustProxy: options.trustProxy ?? false });
  await app.init();
  return app;
}

describe("platform", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("health is ok", async () => {
    const res = await request(server(app)).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("ready is ok when postgres and redis answer", async () => {
    const res = await request(server(app)).get("/api/v1/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
  });

  it("serves the OpenAPI document", async () => {
    const res = await request(server(app)).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect((res.body as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("accepts a valid contract request and passes parsed data", async () => {
    const res = await request(server(app)).post("/api/v1/_test/items/42?page=3").send({ n: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ n: 5, page: 3 });
  });

  it("rejects invalid body, params and query with VALIDATION_FAILED and details", async () => {
    const res = await request(server(app))
      .post("/api/v1/_test/items/abc?page=zzz")
      .send({ n: "SuperSecretInput" });
    expect(res.status).toBe(400);
    const body = res.body as {
      error: { code: string; requestId: string; details: { path: string; message: string }[] };
    };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.details.map((d) => d.path).sort()).toEqual(["id", "n", "page"]);
    expect(JSON.stringify(res.body)).not.toContain("SuperSecretInput");
  });

  it("returns 500 INTERNAL when a response violates its contract (non-production)", async () => {
    const res = await request(server(app)).get("/api/v1/_test/bad-response");
    expect(res.status).toBe(500);
    expect((res.body as { error: { code: string } }).error.code).toBe("INTERNAL");
  });

  it("unknown error becomes INTERNAL without stack or internal message", async () => {
    const res = await request(server(app)).get("/api/v1/_test/boom");
    expect(res.status).toBe(500);
    const body = res.body as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.requestId).toBeTruthy();
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("at ");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("secret-internal-detail");
  });

  it("unknown route is a contract-shaped NOT_FOUND", async () => {
    const res = await request(server(app)).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("accepts a body of about 500 KB", async () => {
    const res = await request(server(app))
      .post("/api/v1/_test/items/42")
      .send({ n: 1, pad: "x".repeat(500_000) });
    expect(res.status).toBe(201);
  });

  it("rejects bodies over 1 MB", async () => {
    const res = await request(server(app))
      .post("/api/v1/_test/items/42")
      .send({ n: 1, pad: "x".repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("sets security headers", async () => {
    const res = await request(server(app)).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("echoes a valid x-request-id and replaces an invalid one", async () => {
    const ok = await request(server(app))
      .get("/api/v1/health")
      .set("x-request-id", "abcd-1234-efgh");
    expect(ok.headers["x-request-id"]).toBe("abcd-1234-efgh");

    const bad = await request(server(app))
      .get("/api/v1/health")
      .set("x-request-id", "bad idé;<script>");
    const replaced = bad.headers["x-request-id"] as string;
    expect(replaced).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(replaced).not.toContain("script");

    const error = await request(server(app))
      .get("/api/v1/nope")
      .set("x-request-id", "abcd-1234-efgh");
    expect((error.body as { error: { requestId: string } }).error.requestId).toBe("abcd-1234-efgh");
  });
});

describe("platform with a failing dependency", () => {
  it("ready reports the failed dependency with 503", async () => {
    const app = await buildApp({ overrideRedis: true });
    try {
      const res = await request(server(app)).get("/api/v1/ready");
      expect(res.status).toBe(503);
      const body = res.body as { status: string; checks: Record<string, string> };
      expect(body.status).toBe("fail");
      expect(body.checks["redis"]).toBe("fail");
      expect(body.checks["postgres"]).toBe("ok");
    } finally {
      await app.close();
    }
  });
});

describe("throttling", () => {
  it("returns a contract-shaped 429 after the limit and never throttles probes", async () => {
    const app = await buildApp({ rateLimitPerMinute: 3 });
    try {
      const get = () => request(server(app)).get("/api/v1/_test/ping");
      for (let i = 0; i < 3; i++) expect((await get()).status).toBe(200);
      const limited = await get();
      expect(limited.status).toBe(429);
      const body = limited.body as { error: { code: string; message: string; requestId: string } };
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.error.requestId).toBeTruthy();

      for (const path of ["/api/v1/health", "/api/v1/ready", "/api/v1/openapi.json"]) {
        for (let i = 0; i < 5; i++) expect((await request(server(app)).get(path)).status).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});

describe("throttling per caller", () => {
  it("keys the bucket by bearer token: different tokens never share a bucket", async () => {
    const app = await buildApp({ rateLimitPerMinute: 3 });
    try {
      const get = (token: string) =>
        request(server(app)).get("/api/v1/_test/ping").set("authorization", `Bearer ${token}`);
      for (let i = 0; i < 3; i++) expect((await get("token-a")).status).toBe(200);
      expect((await get("token-a")).status).toBe(429);
      for (let i = 0; i < 3; i++) expect((await get("token-b")).status).toBe(200);
      expect((await get("token-b")).status).toBe(429);
      // Requests without a bearer fall back to the IP bucket, which is still untouched.
      expect((await request(server(app)).get("/api/v1/_test/ping")).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("limits rotating garbage bearers per IP so fresh tokens cannot bypass the limit", async () => {
    const app = await buildApp({ rateLimitPerIpPerMinute: 3 });
    try {
      const get = (token: string) =>
        request(server(app)).get("/api/v1/_test/ping").set("authorization", `Bearer ${token}`);
      for (let i = 0; i < 3; i++) expect((await get(`garbage-${String(i)}`)).status).not.toBe(429);
      const limited = await get("garbage-3");
      expect(limited.status).toBe(429);
      expect((limited.body as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
      // Probes stay unthrottled for the IP bucket too.
      expect((await request(server(app)).get("/api/v1/health")).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("exempts trusted IPs from the per-IP limit but not from the per-token limit", async () => {
    const app = await buildApp({
      rateLimitPerMinute: 4,
      rateLimitPerIpPerMinute: 3,
      throttleTrustedIps: ["127.0.0.1"],
    });
    try {
      const get = (token: string) =>
        request(server(app)).get("/api/v1/_test/ping").set("authorization", `Bearer ${token}`);
      for (let i = 0; i < 6; i++) {
        expect((await get(`garbage-${String(i)}`)).status).not.toBe(429);
      }
      for (let i = 0; i < 4; i++) expect((await get("same-token")).status).toBe(200);
      expect((await get("same-token")).status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("shares one ip bucket across routes", async () => {
    const app = await buildApp({ rateLimitPerIpPerMinute: 3 });
    try {
      const get = (path: string) => request(server(app)).get(path);
      expect((await get("/api/v1/_test/ping")).status).toBe(200);
      expect((await get("/api/v1/_test/pong")).status).toBe(200);
      expect((await get("/api/v1/_test/ping")).status).toBe(200);
      expect((await get("/api/v1/_test/pong")).status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("with TRUST_PROXY=1 keys the ip bucket on the proxy-appended address, not forged XFF", async () => {
    const app = await buildApp({ rateLimitPerIpPerMinute: 3, trustProxy: 1 });
    try {
      const get = (i: number) =>
        request(server(app))
          .get("/api/v1/_test/ping")
          .set("x-forwarded-for", `forged-${String(i)}, 10.9.9.9`)
          .set("authorization", `Bearer garbage-${String(i)}`);
      for (let i = 0; i < 3; i++) expect((await get(i)).status).toBe(200);
      expect((await get(3)).status).toBe(429);
    } finally {
      await app.close();
    }
  });
});
