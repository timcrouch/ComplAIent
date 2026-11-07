import { randomBytes } from "node:crypto";
import {
  createGateway,
  createMockProvider,
  createPrismaAiStore,
  ensureLibraryEmbedded,
  MOCK_MODEL,
  sealSecret,
  type AiProvider,
} from "@isms/ai";
import { createHashEmbedder } from "@isms/ai/testing";
import type { Embedder } from "@isms/ai";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { embedLibrary } from "../src/jobs/embed-library.js";
import { suggestControls } from "../src/jobs/suggest-controls.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const SECRETS_KEY = randomBytes(32);
const REASON = "Matches the scenario described.";
const embedder = createHashEmbedder();

const CODES = ["AST-01", "AST-02", "AST-03", "OPS-01", "OPS-02", "OPS-03", "PPL-01", "PPL-02"];

let userId = "";

function gatewayWith(providerFactory?: () => AiProvider) {
  return createGateway({
    store: createPrismaAiStore(app),
    secretsKey: SECRETS_KEY,
    provider: "mock",
    ...(providerFactory ? { providerFactory } : {}),
  });
}

async function enableAi(enabled = true): Promise<void> {
  await owner.aiSettings.create({
    data: {
      enabled,
      sealedKey: new Uint8Array(sealSecret("sk-or-test-only-worker-0000", SECRETS_KEY)),
      keyLast4: "0000",
      keySetById: userId,
      keySetAt: new Date(),
      models: { controls: MOCK_MODEL.id },
    },
  });
}

async function createRisk(state: "proposed" | "returned" | "in_review" | "approved" = "proposed") {
  return owner.risk.create({
    data: {
      title: "Lost laptop with payroll export",
      scenario: "A manager keeps the payroll export on a laptop.",
      threat: "The laptop is stolen.",
      consequence: "Salaries are disclosed.",
      reporterId: userId,
      aiAssisted: false,
      state,
      controlSuggestion: "pending",
    },
  });
}

async function controlId(code: string): Promise<string> {
  return (await owner.control.findUniqueOrThrow({ where: { code } })).id;
}

function payload(riskId: string) {
  return { riskId, requestedById: userId, version: 1 };
}

beforeEach(async () => {
  await resetTestDatabase();
  const user = await owner.user.create({
    data: { idpIssuer: "i", idpSubject: "s", email: "w@example.test", displayName: "W" },
  });
  userId = user.id;
  for (const code of CODES) {
    await owner.control.create({
      data: {
        code,
        title: `Control ${code}`,
        description: `Description of ${code}`,
        guidance: [],
        category: "operations",
        libraryVersion: "test",
      },
    });
  }
  await ensureLibraryEmbedded(app, embedder);
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("risk.suggest_controls job", () => {
  it("discards codes that are not among the candidates", async () => {
    await enableAi();
    const risk = await createRisk();
    await suggestControls({ db: app, gateway: gatewayWith(), embedder }, payload(risk.id));

    const rows = await owner.riskControl.findMany({
      where: { riskId: risk.id },
      include: { control: true },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.control.code)).not.toContain("ZZZ-99");
    for (const row of rows) {
      expect(row).toMatchObject({ status: "suggested", source: "ai", reason: REASON });
      expect(row.aiInteractionId).toEqual(expect.any(String));
    }
    const interaction = await owner.aiInteraction.findUniqueOrThrow({
      where: { id: rows[0]?.aiInteractionId ?? "" },
    });
    expect(interaction).toMatchObject({
      purpose: "control_suggestion",
      status: "ok",
      discardedCount: 1,
      outcome: "pending",
      objectType: "Risk",
      objectId: risk.id,
      actorUserId: userId,
    });
    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after).toMatchObject({
      controlSuggestion: "ready",
      controlSuggestionFailure: null,
      version: 1,
    });
    expect(await owner.auditEvent.count()).toBe(0);
  });

  it("keeps at most 6 suggestions and never duplicates a control already on the risk", async () => {
    await enableAi();
    const risk = await createRisk();
    await owner.riskControl.create({
      data: {
        riskId: risk.id,
        controlId: await controlId("AST-01"),
        status: "accepted",
        source: "person",
        suggestedById: userId,
      },
    });
    const all = [...CODES, "AST-02"].map((code) => ({ code, reason: REASON }));
    const provider = createMockProvider({ script: () => JSON.stringify({ suggestions: all }) });
    await suggestControls(
      { db: app, gateway: gatewayWith(() => provider), embedder },
      payload(risk.id),
    );

    const rows = await owner.riskControl.findMany({
      where: { riskId: risk.id, status: "suggested" },
      include: { control: true },
    });
    expect(rows.map((r) => r.control.code).sort()).toEqual([
      "AST-02",
      "AST-03",
      "OPS-01",
      "OPS-02",
      "OPS-03",
      "PPL-01",
    ]);
    const interaction = await owner.aiInteraction.findFirstOrThrow();
    // 9 returned: AST-01 already on the risk, PPL-02 over the limit, AST-02 repeated.
    expect(interaction.discardedCount).toBe(3);
    expect(await owner.riskControl.count({ where: { riskId: risk.id } })).toBe(7);
  });

  it("a new run replaces undecided suggestions but keeps accepted and rejected ones", async () => {
    await enableAi();
    const risk = await createRisk();
    let codes = ["AST-01", "AST-02", "AST-03"];
    const provider = createMockProvider({
      script: () =>
        JSON.stringify({ suggestions: codes.map((code) => ({ code, reason: REASON })) }),
    });
    const deps = { db: app, gateway: gatewayWith(() => provider), embedder };
    await suggestControls(deps, payload(risk.id));
    await owner.riskControl.updateMany({
      where: { riskId: risk.id, controlId: await controlId("AST-01") },
      data: { status: "accepted", decidedById: userId, decidedAt: new Date() },
    });
    await owner.riskControl.updateMany({
      where: { riskId: risk.id, controlId: await controlId("AST-02") },
      data: { status: "rejected", decidedById: userId, decidedAt: new Date() },
    });

    codes = ["AST-01", "OPS-01", "OPS-02"];
    await suggestControls(deps, payload(risk.id));

    const rows = await owner.riskControl.findMany({
      where: { riskId: risk.id },
      include: { control: true },
    });
    const byCode = Object.fromEntries(rows.map((r) => [r.control.code, r.status]));
    expect(byCode).toEqual({
      "AST-01": "accepted",
      "AST-02": "rejected",
      "OPS-01": "suggested",
      "OPS-02": "suggested",
    });
    const interactions = await owner.aiInteraction.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(interactions).toHaveLength(2);
    const suggested = rows.filter((r) => r.status === "suggested");
    expect(suggested.every((r) => r.aiInteractionId === interactions[1]?.id)).toBe(true);
  });

  it("marks the risk failed with the readiness reason when AI is off", async () => {
    await enableAi(false);
    const risk = await createRisk();
    await suggestControls({ db: app, gateway: gatewayWith(), embedder }, payload(risk.id));

    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after).toMatchObject({
      controlSuggestion: "failed",
      controlSuggestionFailure: "disabled",
    });
    expect(await owner.riskControl.count()).toBe(0);
    expect(await owner.aiInteraction.count()).toBe(0);
  });

  it("adds nothing and marks the risk failed when it is no longer editable", async () => {
    await enableAi();
    const risk = await createRisk("in_review");
    await suggestControls({ db: app, gateway: gatewayWith(), embedder }, payload(risk.id));

    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after).toMatchObject({
      controlSuggestion: "failed",
      controlSuggestionFailure: "riskNotEditable",
    });
    expect(await owner.riskControl.count()).toBe(0);
    expect(await owner.aiInteraction.count()).toBe(0);
  });

  it("still adds suggestions to a returned risk whose version moved on", async () => {
    await enableAi();
    const risk = await createRisk("returned");
    await owner.risk.update({ where: { id: risk.id }, data: { version: 3 } });
    await suggestControls({ db: app, gateway: gatewayWith(), embedder }, payload(risk.id));

    expect(await owner.riskControl.count({ where: { riskId: risk.id } })).toBe(3);
    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after).toMatchObject({ controlSuggestion: "ready", version: 3 });
  });
});

describe("risk.suggest_controls job: ordering, concurrency and retries", () => {
  it("fails as disabled before embedding or retrieval when AI is off", async () => {
    await enableAi(false);
    await owner.controlEmbedding.deleteMany();
    const risk = await createRisk();
    let embedded = 0;
    const counting: Embedder = {
      ...embedder,
      embed(texts) {
        embedded += texts.length;
        return embedder.embed(texts);
      },
    };
    await suggestControls(
      { db: app, gateway: gatewayWith(), embedder: counting },
      payload(risk.id),
    );

    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after).toMatchObject({
      controlSuggestion: "failed",
      controlSuggestionFailure: "disabled",
    });
    expect(embedded).toBe(0);
  });

  it("two concurrent jobs for one risk both succeed and leave one set of suggestions", async () => {
    await enableAi();
    const risk = await createRisk();
    const deps = { db: app, gateway: gatewayWith(), embedder };
    await Promise.all([
      suggestControls(deps, payload(risk.id)),
      suggestControls(deps, payload(risk.id)),
    ]);

    expect(await owner.riskControl.count({ where: { riskId: risk.id } })).toBe(3);
    const after = await owner.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(after.controlSuggestion).toBe("ready");
  });

  it("leaves the risk pending on an early failed attempt and marks it failed on the last", async () => {
    await enableAi();
    const risk = await createRisk();
    const broken: Embedder = {
      ...embedder,
      embed: () => Promise.reject(new Error("model crashed")),
    };
    const deps = { db: app, gateway: gatewayWith(), embedder: broken };

    await expect(
      suggestControls(deps, payload(risk.id), { attempt: 1, maxAttempts: 3 }),
    ).rejects.toThrow("model crashed");
    expect((await owner.risk.findUniqueOrThrow({ where: { id: risk.id } })).controlSuggestion).toBe(
      "pending",
    );

    await expect(
      suggestControls(deps, payload(risk.id), { attempt: 3, maxAttempts: 3 }),
    ).rejects.toThrow("model crashed");
    expect(await owner.risk.findUniqueOrThrow({ where: { id: risk.id } })).toMatchObject({
      controlSuggestion: "failed",
      controlSuggestionFailure: "unavailable",
    });
  });
});

describe("library.embed job", () => {
  it("embeds only new controls", async () => {
    const run = (requestedAt: string) => embedLibrary({ db: app, embedder }, { requestedAt });
    expect(await run("2026-11-05T10:00:00.000Z")).toEqual({ embedded: 0 });
    await owner.control.create({
      data: {
        code: "NEW-01",
        title: "New control",
        description: "d",
        guidance: [],
        category: "operations",
        libraryVersion: "test",
      },
    });
    expect(await run("2026-11-05T10:01:00.000Z")).toEqual({ embedded: 1 });
  });
});
