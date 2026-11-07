import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaAiStore } from "../src/prisma-store.js";
import type { InteractionRecord } from "../src/store.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const RECORD: InteractionRecord = {
  purpose: "concern_turn",
  provider: "mock",
  model: "mock/isms-test",
  routing: { baseUrl: "mock://isms", zdr: true, dataCollection: "deny", upstream: null },
  request: { system: "s", messages: [{ role: "user", content: "hello" }] },
  response: '{"ok":true}',
  status: "ok",
  attempts: 1,
  durationMs: 12,
  actorUserId: null,
  objectType: "ConcernConversation",
  objectId: "c-1",
};

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("Prisma AI store", () => {
  it("returns the defaults when no settings row exists, and the stored row otherwise", async () => {
    const store = createPrismaAiStore(app);
    expect(await store.loadSettings()).toMatchObject({
      enabled: false,
      euOnly: true,
      zeroRetention: true,
      sealedKey: null,
      models: {},
    });
    await owner.aiSettings.create({
      data: { enabled: true, models: { conversation: "vendor/a", controls: 42, junk: "x" } },
    });
    const loaded = await store.loadSettings();
    expect(loaded).toMatchObject({ enabled: true, models: { conversation: "vendor/a" } });
    expect(loaded.models).toEqual({ conversation: "vendor/a" });
  });

  it("loads settings from concurrent callers in the same tick", async () => {
    // Prisma batches same-tick findUnique calls into one query using `in`, which a Boolean
    // unique (singleton) does not support; loadSettings must not take that path.
    await owner.aiSettings.create({ data: { enabled: true } });
    const store = createPrismaAiStore(app);
    const loaded = await Promise.all([store.loadSettings(), store.loadSettings()]);
    expect(loaded.map((s) => s.enabled)).toEqual([true, true]);
  });

  it("returns the sealed key as a Buffer", async () => {
    const user = await owner.user.create({
      data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
    });
    await owner.aiSettings.create({
      data: {
        sealedKey: new Uint8Array([1, 2, 3]),
        keyLast4: "WXYZ",
        keySetById: user.id,
        keySetAt: new Date(),
      },
    });
    const { sealedKey } = await createPrismaAiStore(app).loadSettings();
    expect(Buffer.isBuffer(sealedKey)).toBe(true);
    expect([...(sealedKey ?? [])]).toEqual([1, 2, 3]);
  });

  it("records an interaction as the app role", async () => {
    const id = await createPrismaAiStore(app).recordInteraction(RECORD);
    const row = await owner.aiInteraction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ ...RECORD, outcome: "none", discardedCount: 0 });
  });

  it("the app role can set outcome but cannot change response or delete an interaction", async () => {
    const store = createPrismaAiStore(app);
    const id = await store.recordInteraction(RECORD);
    await store.setOutcome(id, "accepted");
    expect((await owner.aiInteraction.findUniqueOrThrow({ where: { id } })).outcome).toBe(
      "accepted",
    );

    await expect(
      app.aiInteraction.update({ where: { id }, data: { response: "tampered" } }),
    ).rejects.toThrow(/permission denied/);
    await expect(app.aiInteraction.delete({ where: { id } })).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`TRUNCATE "AiInteraction"`).rejects.toThrow(/permission denied/);
    expect((await owner.aiInteraction.findUniqueOrThrow({ where: { id } })).response).toBe(
      '{"ok":true}',
    );
  });

  it("the app role can set the discarded count, and a negative count is refused", async () => {
    const store = createPrismaAiStore(app);
    const id = await store.recordInteraction(RECORD);
    await store.setDiscardedCount(id, 2);
    expect((await owner.aiInteraction.findUniqueOrThrow({ where: { id } })).discardedCount).toBe(2);
    await expect(store.setDiscardedCount(id, -1)).rejects.toThrow(/non-negative/);
    await expect(
      app.$executeRaw`UPDATE "AiInteraction" SET "discardedCount" = -1 WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/check constraint/);
  });
});
