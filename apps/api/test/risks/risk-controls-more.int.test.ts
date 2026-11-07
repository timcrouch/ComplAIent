import { randomBytes, randomUUID } from "node:crypto";
import { MOCK_MODEL } from "@isms/ai";
import { loadConfig, redisConfig } from "@isms/config";
import type { RiskDetailDto } from "@isms/contracts";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiModule } from "../../src/ai/index.js";
import { audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

const secretsKey = randomBytes(32);
const prefix = `isms-test-${randomUUID()}`;
const redis = new Redis(loadConfig(redisConfig).REDIS_URL, {
  maxRetriesPerRequest: 1,
});

const h = risksHarness({
  jobsPrefix: prefix,
  imports: [AiModule.forRoot({ secretsKey, provider: "mock" })],
});

beforeAll(() => h.start());
beforeEach(() => h.reset());
afterAll(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  redis.disconnect();
  await h.stop();
});

const control = (code: string, title: string) =>
  db.control.create({
    data: {
      code,
      title,
      description: `${title} description`,
      category: "access",
      libraryVersion: "t1",
    },
  });

const report = async (overrides: Record<string, unknown> = {}) => {
  const res = await h.post("/api/v1/risks", reportBody(overrides), "rita");
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as RiskDetailDto;
};
const dto = (res: { body: unknown }) => res.body as RiskDetailDto;
const base = (riskId: string) => `/api/v1/risks/${riskId}`;

/** A risk with an AI run's two suggestions, as the worker leaves them. */
async function withSuggestions(overrides: Record<string, unknown> = {}) {
  const risk = await report(overrides);
  const [a, b] = await Promise.all([
    control("ACC-01", "Access reviews"),
    control("ACC-02", "Passwords"),
  ]);
  const interaction = await db.aiInteraction.create({
    data: {
      purpose: "control_suggestion",
      provider: "mock",
      model: MOCK_MODEL.id,
      routing: {},
      request: {},
      status: "ok",
      attempts: 1,
      durationMs: 1,
      objectType: "Risk",
      objectId: risk.id,
      outcome: "pending",
    },
  });
  const make = (controlId: string) =>
    db.riskControl.create({
      data: {
        riskId: risk.id,
        controlId,
        status: "suggested",
        reason: "Fits the risk",
        source: "ai",
        aiInteractionId: interaction.id,
      },
    });
  const [rcA, rcB] = [await make(a.id), await make(b.id)];
  return { risk, interaction, rcA, rcB, a, b };
}

const outcomeOf = async (id: string) =>
  (await db.aiInteraction.findUniqueOrThrow({ where: { id } })).outcome;

describe("risk controls: re-adding and conflicts", () => {
  it("re-adding a rejected control accepts it by hand and leaves the AI outcome alone", async () => {
    const { risk, interaction, rcA, rcB } = await withSuggestions();
    const decision = (rc: { id: string }, version: number, d: "accept" | "reject") =>
      h.post(
        `${base(risk.id)}/controls/${rc.id}/decision`,
        { expectedVersion: version, decision: d },
        "cora",
      );
    await decision(rcA, 1, "reject");
    await decision(rcB, 2, "reject");
    expect(await outcomeOf(interaction.id)).toBe("rejected");
    const res = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 3, controlCode: "ACC-01", reason: "We do need it" },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(dto(res).controls.find((c) => c.id === rcA.id)).toMatchObject({
      status: "accepted",
      source: "person",
      reason: "We do need it",
      decidedBy: { id: h.userIds.cora },
    });
    const row = await db.riskControl.findUniqueOrThrow({ where: { id: rcA.id } });
    expect(row.aiInteractionId).toBeNull();
    expect((await audits("risk.control_added")).length).toBe(1);
    expect(dto(res).version).toBe(4);
    // The run's outcome is unchanged, and a live (accepted) row is a duplicate again.
    expect(await outcomeOf(interaction.id)).toBe("rejected");
    const dup = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 4, controlCode: "ACC-01" },
      "cora",
    );
    expect(detailPaths(dup)).toEqual(["duplicateRiskControl"]);
    // A suggested row is a duplicate too.
    const { risk: r2 } = await (async () => {
      const r = await report({ title: "Second" });
      await db.riskControl.create({
        data: { riskId: r.id, controlId: row.controlId, status: "suggested", source: "ai" },
      });
      return { risk: r };
    })();
    const dup2 = await h.post(
      `${base(r2.id)}/controls`,
      { expectedVersion: 1, controlCode: "ACC-01" },
      "cora",
    );
    expect(detailPaths(dup2)).toEqual(["duplicateRiskControl"]);
  });

  it("is refused on a stale version for decide and add, and 404 for another risk's control", async () => {
    const { risk, rcA } = await withSuggestions();
    const other = await report({ title: "Another risk" });
    const stale = await h.post(
      `${base(risk.id)}/controls/${rcA.id}/decision`,
      { expectedVersion: 5, decision: "accept" },
      "cora",
    );
    expect(stale.status).toBe(409);
    expect(detailPaths(stale)).toEqual(["staleVersion"]);
    const staleAdd = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 5, controlCode: "ACC-01" },
      "cora",
    );
    expect(detailPaths(staleAdd)).toEqual(["staleVersion"]);
    const foreign = await h.post(
      `${base(other.id)}/controls/${rcA.id}/decision`,
      { expectedVersion: 1, decision: "accept" },
      "cora",
    );
    expect(foreign.status).toBe(404);
    const foreignRemove = await h.delete(
      `${base(other.id)}/controls/${rcA.id}`,
      { expectedVersion: 1 },
      "cora",
    );
    expect(foreignRemove.status).toBe(404);
  });
});
