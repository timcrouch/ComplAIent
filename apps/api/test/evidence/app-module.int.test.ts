import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppModule } from "../../src/app.module.js";
import { loadAppConfig } from "../../src/config.js";
import { configureApp } from "../../src/platform/index.js";
import { ensureBucket, storage } from "./harness.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));

describe("the real AppModule", () => {
  let app: INestApplication;

  beforeAll(async () => {
    await ensureBucket();
    const config = loadAppConfig({
      DATABASE_URL: env.DATABASE_TEST_URL,
      REDIS_URL: env.REDIS_URL,
      OIDC_ISSUER_URL: "http://127.0.0.1:1/realms/unused",
      OIDC_AUDIENCE: "isms-api",
      LOG_LEVEL: "fatal",
      AI_PROVIDER: "mock",
      S3_ENDPOINT: storage.S3_ENDPOINT,
      S3_REGION: storage.S3_REGION,
      S3_BUCKET: storage.S3_BUCKET,
      S3_ACCESS_KEY_ID: storage.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: storage.S3_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: "true",
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, {
      trustProxy: false,
      uploadLimits: { EVIDENCE_MAX_BYTES: config.EVIDENCE_MAX_BYTES },
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("resolves the object store into the readiness check", async () => {
    const res = await request(app.getHttpServer() as Server).get("/api/v1/ready");
    expect(res.body).toEqual({
      status: "ok",
      checks: { postgres: "ok", redis: "ok", storage: "ok" },
    });
  });
});
