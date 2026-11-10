import { randomBytes } from "node:crypto";
import {
  createGateway,
  createMockProvider,
  createPrismaAiStore,
  MOCK_MODEL,
  ProviderError,
  sealSecret,
} from "@isms/ai";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateConcern } from "../src/jobs/evaluate-concern.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const secret = randomBytes(32);
const logger = { info: vi.fn(), warn: vi.fn() };
let userId = "";

function gateway(reply?: () => string | ProviderError) {
  return createGateway({
    store: createPrismaAiStore(app),
    secretsKey: secret,
    provider: "mock",
    ...(reply ? { providerFactory: () => createMockProvider({ script: reply }) } : {}),
  });
}

async function report(title: string) {
  const risk = await owner.risk.create({
    data: {
      title,
      scenario: `${title} could expose sensitive information.`,
      threat: "Unauthorized access",
      consequence: "Sensitive information could be disclosed.",
      reporterId: userId,
      aiAssisted: false,
    },
  });
  const evaluation = await owner.concernEvaluation.create({
    data: { riskId: risk.id, reporterId: userId },
  });
  return { risk, evaluation };
}

beforeEach(async () => {
  await resetTestDatabase();
  logger.info.mockReset();
  logger.warn.mockReset();
  userId = (
    await owner.user.create({
      data: {
        idpIssuer: "test",
        idpSubject: "reporter",
        email: "reporter-secret@example.test",
        displayName: "Private Reporter",
      },
    })
  ).id;
  await owner.organisation.create({
    data: { name: "Test", description: "", concernRewardsEnabled: true },
  });
  await owner.aiSettings.create({
    data: {
      enabled: true,
      euOnly: true,
      zeroRetention: true,
      sealedKey: new Uint8Array(sealSecret("sk-or-test-concern-evaluation", secret)),
      keyLast4: "tion",
      keySetById: userId,
      keySetAt: new Date(),
      models: { conversation: MOCK_MODEL.id },
    },
  });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("concern.evaluate", () => {
  it("awards a confirmed critical first report immediately without sending reporter identity", async () => {
    const { evaluation } = await report("Unlocked administrator laptop used by an unknown person");
    await evaluateConcern({ db: app, gateway: gateway(), logger }, { evaluationId: evaluation.id });

    const saved = await owner.concernEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } });
    expect(saved).toMatchObject({
      status: "provisional",
      source: "ai",
      legitimacy: "confirmed",
      severity: "critical",
      duplicatePosition: 1,
      legitimacyPoints: 100,
      severityPoints: 100,
      positionPoints: 50,
      totalPoints: 250,
      requiresReview: true,
    });
    expect((await owner.concernRewardEntry.findFirstOrThrow()).points).toBe(250);
    expect(
      (await owner.concernBadgeEvent.findMany()).map((event) => event.badgeKey).sort(),
    ).toEqual(["first_signal", "high_impact"]);
    const interaction = await owner.aiInteraction.findFirstOrThrow();
    expect(interaction).toMatchObject({ purpose: "concern_evaluation", outcome: "accepted" });
    const sent = JSON.stringify(interaction.request);
    expect(sent).not.toContain("reporter-secret@example.test");
    expect(sent).not.toContain("Private Reporter");
  });

  it("keeps a provider failure pending for the CISO queue", async () => {
    const { evaluation } = await report("Suspicious prompt");
    await evaluateConcern(
      { db: app, gateway: gateway(() => new ProviderError("unavailable")), logger },
      { evaluationId: evaluation.id },
    );
    expect(
      await owner.concernEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } }),
    ).toMatchObject({ status: "pending", failureReason: "providerError", totalPoints: 0 });
    expect(await owner.concernRewardEntry.count()).toBe(0);
  });

  it("records repeatable badges once per qualifying evaluation and remains idempotent", async () => {
    const first = await report("First critical concern");
    const second = await report("Second critical concern");
    const response = JSON.stringify({
      legitimacy: "confirmed",
      severity: "critical",
      confidence: 0.95,
      duplicateRiskId: null,
      reporterFeedback: "Thank you for reporting this critical security concern.",
      cisoRationale: "The concern has potentially critical impact.",
      uncertainty: "",
    });
    await evaluateConcern(
      { db: app, gateway: gateway(() => response), logger },
      { evaluationId: first.evaluation.id },
    );
    await evaluateConcern(
      { db: app, gateway: gateway(() => response), logger },
      { evaluationId: second.evaluation.id },
    );
    await evaluateConcern(
      { db: app, gateway: gateway(() => response), logger },
      { evaluationId: second.evaluation.id },
    );

    const awards = await owner.concernBadgeEvent.findMany({ where: { kind: "awarded" } });
    expect(awards.filter((event) => event.badgeKey === "first_signal")).toHaveLength(2);
    expect(awards.filter((event) => event.badgeKey === "high_impact")).toHaveLength(2);
  });

  it("uses the fixed first-through-sixth duplicate bonuses and awards milestone badges", async () => {
    let canonicalRiskId: string | null = null;
    const totals: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const { risk, evaluation } = await report(`Concern ${String(index + 1)}`);
      canonicalRiskId ??= risk.id;
      const duplicate = index === 0 ? null : canonicalRiskId;
      const response = JSON.stringify({
        legitimacy: duplicate ? "confirmed_duplicate" : "confirmed",
        severity: "moderate",
        confidence: 0.95,
        duplicateRiskId: duplicate,
        reporterFeedback: "Thank you for reporting this security concern.",
        cisoRationale: "The report describes the same concrete security weakness.",
        uncertainty: "",
      });
      await evaluateConcern(
        { db: app, gateway: gateway(() => response), logger },
        { evaluationId: evaluation.id },
      );
      totals.push(
        (await owner.concernEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } }))
          .totalPoints,
      );
    }
    expect(totals).toEqual([175, 150, 140, 135, 130, 125]);
    const badges = (await owner.concernBadgeEvent.findMany()).map((event) => event.badgeKey);
    expect(badges).toContain("first_signal");
    expect(badges).toContain("corroborator");
    expect(badges).toContain("sharp_eye");
    expect(badges.filter((badge) => badge === "corroborator")).toHaveLength(5);
  });
});
