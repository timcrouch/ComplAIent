import { randomUUID } from "node:crypto";
import { createGateway, createPrismaAiStore } from "@isms/ai";
import { createHashEmbedder } from "@isms/ai/testing";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewDue } from "../src/jobs/review-due.js";
import { suggestControls } from "../src/jobs/suggest-controls.js";

// P9-R4: a demo reset removes every risk, and a job that was already running (or was queued
// against a risk that is now gone) must finish as a no-op rather than fail or retry.
const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
});

describe("jobs after a reset", () => {
  it("risk.suggest_controls given a missing risk id resolves without throwing", async () => {
    const gateway = createGateway({
      store: createPrismaAiStore(app),
      secretsKey: randomBytes(32),
      provider: "mock",
    });
    await expect(
      suggestControls(
        { db: app, gateway, embedder: createHashEmbedder() },
        { riskId: randomUUID(), requestedById: randomUUID(), version: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it("risk.review_due on an empty database resolves and creates nothing", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(reviewDue({ db: app, logger }, new Date())).resolves.toEqual({ created: 0 });
  });
});
