import { randomBytes, randomUUID } from "node:crypto";
import { MOCK_MODEL, sealSecret } from "@isms/ai";
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
const QUEUE = "risk.suggest_controls";

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

async function enableAi(enabled = true): Promise<void> {
  await db.aiSettings.create({
    data: {
      enabled,
      sealedKey: new Uint8Array(sealSecret("sk-or-test-only-controls-0000", secretsKey)),
      keyLast4: "0000",
      keySetById: h.userIds.admin,
      keySetAt: new Date(),
      models: { controls: MOCK_MODEL.id },
    },
  });
}

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

describe("risk controls", () => {
  it("requesting suggestions enqueues one job per risk version and marks pending", async () => {
    await enableAi();
    const risk = await report();
    const url = `${base(risk.id)}/control-suggestions`;
    const res = await h.post(url, { expectedVersion: 1 }, "cora");
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(dto(res).controlSuggestion).toEqual({
      status: "pending",
      failure: null,
    });
    const key = `${prefix}:${QUEUE}:${QUEUE}__${risk.id}__1`;
    expect(JSON.parse((await redis.hget(key, "data")) ?? "null")).toEqual({
      riskId: risk.id,
      requestedById: h.userIds.cora,
      version: 1,
    });
    expect((await h.post(url, { expectedVersion: 1 }, "cora")).status).toBe(202);
    expect(await redis.keys(`${prefix}:${QUEUE}:${QUEUE}__*`)).toEqual([key]);
    expect((await h.post(url, { expectedVersion: 7 }, "cora")).status).toBe(409);
  });

  it("refuses suggestions when AI is off: 409 aiUnavailable.disabled", async () => {
    await enableAi(false);
    const risk = await report();
    const res = await h.post(
      `${base(risk.id)}/control-suggestions`,
      { expectedVersion: 1 },
      "cora",
    );
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.disabled"]);
    expect((await db.risk.findUniqueOrThrow({ where: { id: risk.id } })).controlSuggestion).toBe(
      "none",
    );
    expect(await redis.keys(`${prefix}:${QUEUE}:${QUEUE}__${risk.id}*`)).toEqual([]);
  });

  it("can.suggestControls: only for an editor, and only while the AI can suggest controls", async () => {
    const risk = await report();
    const suggestable = async (who: "cora" | "aldo") =>
      dto(await h.get(base(risk.id), who)).can.suggestControls;
    expect(await suggestable("cora")).toBe(false); // no AI settings at all
    await enableAi(false);
    expect(await suggestable("cora")).toBe(false); // AI switched off
    await db.aiSettings.updateMany({ data: { enabled: true } });
    expect(await suggestable("cora")).toBe(true);
    expect(await suggestable("aldo")).toBe(false); // an auditor reads but may not edit
  });

  it("accepting a suggestion writes a version and audit, and records the outcome", async () => {
    const { risk, interaction, rcA, rcB } = await withSuggestions();
    const first = await h.post(
      `${base(risk.id)}/controls/${rcA.id}/decision`,
      { expectedVersion: 1, decision: "accept" },
      "cora",
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(dto(first).version).toBe(2);
    expect(dto(first).controls.find((c) => c.id === rcA.id)).toMatchObject({
      code: "ACC-01",
      status: "accepted",
      source: "ai",
      decidedBy: { id: h.userIds.cora },
      evidenceCount: 0,
    });
    // One suggestion is still open, so the run is not decided yet.
    expect(await outcomeOf(interaction.id)).toBe("pending");
    const version = await db.riskVersion.findFirstOrThrow({
      where: { riskId: risk.id, version: 2 },
    });
    expect(version.changedFields).toEqual(["controls"]);
    expect((version.snapshot as { controls: string[] }).controls).toEqual(["ACC-01"]);
    const [audit] = await audits("risk.control_accepted");
    expect(audit).toMatchObject({ objectType: "Risk", objectId: risk.id });
    expect(audit?.afterRef).toMatchObject({ version: 2, controlCode: "ACC-01" });

    const second = await h.post(
      `${base(risk.id)}/controls/${rcB.id}/decision`,
      { expectedVersion: 2, decision: "accept" },
      "cora",
    );
    expect(second.status).toBe(200);
    expect(await outcomeOf(interaction.id)).toBe("accepted");
    // Deciding twice is refused.
    const again = await h.post(
      `${base(risk.id)}/controls/${rcB.id}/decision`,
      { expectedVersion: 3, decision: "reject" },
      "cora",
    );
    expect(again.status).toBe(409);
    expect(detailPaths(again)).toEqual(["controlNotAccepted"]);
  });

  it("rejecting with a reason keeps the row as rejected; a mix is partial", async () => {
    const { risk, interaction, rcA, rcB } = await withSuggestions();
    const rejected = await h.post(
      `${base(risk.id)}/controls/${rcA.id}/decision`,
      { expectedVersion: 1, decision: "reject", reason: "We already do this" },
      "cora",
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    const row = await db.riskControl.findUniqueOrThrow({
      where: { id: rcA.id },
    });
    expect(row).toMatchObject({
      status: "rejected",
      reason: "We already do this",
    });
    expect(row.decidedById).toBe(h.userIds.cora);
    expect((await audits("risk.control_rejected")).length).toBe(1);
    // A rejection does not change the accepted controls, but still writes a version.
    expect(dto(rejected).version).toBe(2);
    await h.post(
      `${base(risk.id)}/controls/${rcB.id}/decision`,
      { expectedVersion: 2, decision: "accept" },
      "cora",
    );
    expect(await outcomeOf(interaction.id)).toBe("partial");
  });

  it("rejecting every suggestion makes the outcome rejected", async () => {
    const { risk, interaction, rcA, rcB } = await withSuggestions();
    let version = 1;
    for (const rc of [rcA, rcB]) {
      const res = await h.post(
        `${base(risk.id)}/controls/${rc.id}/decision`,
        { expectedVersion: version++, decision: "reject" },
        "cora",
      );
      expect(res.status).toBe(200);
    }
    expect(await outcomeOf(interaction.id)).toBe("rejected");
  });

  it("adds a control manually by code; an unknown code is 400, a repeat is 409", async () => {
    const risk = await report();
    const ctl = await control("ACC-09", "Joiners and leavers");
    const unknown = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 1, controlCode: "ACC-99" },
      "cora",
    );
    expect(unknown.status).toBe(400);
    expect(detailPaths(unknown)).toEqual(["controlCode"]);

    const res = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 1, controlCode: "ACC-09", reason: "Fits" },
      "cora",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(dto(res).controls).toMatchObject([
      {
        code: "ACC-09",
        status: "accepted",
        source: "person",
        reason: "Fits",
        suggestedBy: null,
      },
    ]);
    const row = await db.riskControl.findFirstOrThrow({
      where: { riskId: risk.id },
    });
    expect(row).toMatchObject({
      controlId: ctl.id,
      decidedById: h.userIds.cora,
    });
    expect((await audits("risk.control_added")).length).toBe(1);

    const dup = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 2, controlCode: "ACC-09" },
      "cora",
    );
    expect(dup.status).toBe(409);
    expect(detailPaths(dup)).toEqual(["duplicateRiskControl"]);
  });

  it("cannot decide on a risk in review: 409 riskNotEditable", async () => {
    const { risk, rcA } = await withSuggestions();
    await db.risk.update({
      where: { id: risk.id },
      data: { state: "in_review" },
    });
    const res = await h.post(
      `${base(risk.id)}/controls/${rcA.id}/decision`,
      { expectedVersion: 1, decision: "accept" },
      "cora",
    );
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["riskNotEditable"]);
    const add = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 1, controlCode: "ACC-01" },
      "cora",
    );
    expect(detailPaths(add)).toEqual(["riskNotEditable"]);
  });

  it("a risk owner at another site cannot see the risk: 404; a contributor lacks review: 403", async () => {
    const { risk, rcA } = await withSuggestions({ siteId: h.sites.siteA });
    const decision = `${base(risk.id)}/controls/${rcA.id}/decision`;
    expect(
      (await h.post(decision, { expectedVersion: 1, decision: "accept" }, "olga")).status,
    ).toBe(404);
    expect(
      (
        await h.post(
          `${base(risk.id)}/controls`,
          { expectedVersion: 1, controlCode: "ACC-01" },
          "olga",
        )
      ).status,
    ).toBe(404);
    expect(
      (await h.post(`${base(risk.id)}/control-suggestions`, { expectedVersion: 1 }, "olga")).status,
    ).toBe(404);
    expect(
      (await h.delete(`${base(risk.id)}/controls/${rcA.id}`, { expectedVersion: 1 }, "olga"))
        .status,
    ).toBe(404);
    // The owner at the risk's own site may decide.
    expect(
      (await h.post(decision, { expectedVersion: 1, decision: "accept" }, "oscar")).status,
    ).toBe(200);
    expect(
      (await h.post(decision, { expectedVersion: 2, decision: "accept" }, "carl")).status,
    ).toBe(403);
  });

  it("removes an accepted control without evidence, and not one that has evidence", async () => {
    const risk = await report();
    await control("ACC-05", "Logging");
    await control("ACC-06", "Backups");
    for (const [i, code] of ["ACC-05", "ACC-06"].entries()) {
      const res = await h.post(
        `${base(risk.id)}/controls`,
        { expectedVersion: i + 1, controlCode: code },
        "cora",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const rows = await db.riskControl.findMany({
      where: { riskId: risk.id },
      include: { control: true },
    });
    const byCode = (code: string) => {
      const found = rows.find((r) => r.control.code === code);
      if (!found) throw new Error(`missing ${code}`);
      return found;
    };
    const withEvidence = byCode("ACC-05");
    const plain = byCode("ACC-06");
    const evidence = await db.evidence.create({
      data: {
        riskId: risk.id,
        objectKey: `k-${randomUUID()}`,
        fileName: "policy.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 10,
        mimeType: "application/pdf",
        uploadedById: h.userIds.cora,
        collectedAt: new Date(),
      },
    });
    await db.evidenceControl.create({
      data: { evidenceId: evidence.id, controlId: withEvidence.controlId },
    });

    const blocked = await h.delete(
      `${base(risk.id)}/controls/${withEvidence.id}`,
      { expectedVersion: 3 },
      "cora",
    );
    expect(blocked.status).toBe(409);
    expect(detailPaths(blocked)).toEqual(["controlNotAccepted"]);
    expect(await db.riskControl.count({ where: { riskId: risk.id } })).toBe(2);

    const ok = await h.delete(
      `${base(risk.id)}/controls/${plain.id}`,
      { expectedVersion: 3 },
      "cora",
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(dto(ok).controls.map((c) => c.code)).toEqual(["ACC-05"]);
    expect(dto(ok).controls[0]?.evidenceCount).toBe(1);
    expect(dto(ok).version).toBe(4);
    expect((await audits("risk.control_removed")).length).toBe(1);
    const stale = await h.delete(
      `${base(risk.id)}/controls/${withEvidence.id}`,
      { expectedVersion: 1 },
      "cora",
    );
    expect(detailPaths(stale)).toEqual(["staleVersion"]);
  });

  it("shows requirement references on a control and the suggestion status on the detail", async () => {
    const risk = await report();
    const ctl = await control("ACC-07", "MFA");
    const fw = await db.framework.create({
      data: { key: "fw", name: "Frame", publisher: "p", summary: "s" },
    });
    const fv = await db.frameworkVersion.create({
      data: { frameworkId: fw.id, key: "fw-1", label: "1" },
    });
    const req = await db.requirement.create({
      data: {
        frameworkVersionId: fv.id,
        ref: "A.5.1",
        title: "t",
        sortOrder: 1,
      },
    });
    await db.controlRequirementMapping.create({
      data: { controlId: ctl.id, requirementId: req.id },
    });
    await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 1, controlCode: "ACC-07" },
      "cora",
    );
    const res = await h.get(base(risk.id), "cora");
    expect(dto(res).controls[0]?.refs).toEqual([{ framework: "Frame", ref: "A.5.1" }]);
    expect(dto(res).controlSuggestion).toEqual({
      status: "none",
      failure: null,
    });
  });

  it("a code that is not shaped like a control code is a schema 400", async () => {
    const risk = await report();
    const res = await h.post(
      `${base(risk.id)}/controls`,
      { expectedVersion: 1, controlCode: "NOPE-1" },
      "cora",
    );
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toContain("controlCode");
  });

  it("asking again after a failed run re-queues it; a live job is left alone", async () => {
    await enableAi();
    const risk = await report();
    const url = `${base(risk.id)}/control-suggestions`;
    const jobId = `${QUEUE}__${risk.id}__1`;
    const key = `${prefix}:${QUEUE}:${jobId}`;
    expect((await h.post(url, { expectedVersion: 1 }, "cora")).status).toBe(202);
    // A waiting job is kept as it is.
    await redis.hset(key, "marker", "1");
    expect((await h.post(url, { expectedVersion: 1 }, "cora")).status).toBe(202);
    expect(await redis.hget(key, "marker")).toBe("1");
    // The run fails: BullMQ moves the job from wait to the failed set.
    await redis.lrem(`${prefix}:${QUEUE}:wait`, 0, jobId);
    await redis.zadd(`${prefix}:${QUEUE}:failed`, Date.now(), jobId);
    expect((await h.post(url, { expectedVersion: 1 }, "cora")).status).toBe(202);
    expect(await redis.hget(key, "marker")).toBeNull();
    expect(await redis.hget(key, "data")).not.toBeNull();
    expect(await redis.zscore(`${prefix}:${QUEUE}:failed`, jobId)).toBeNull();
    expect(await redis.lrange(`${prefix}:${QUEUE}:wait`, 0, -1)).toContain(jobId);
    expect((await audits("risk.control_suggestions_requested")).length).toBe(3);
  });
});
