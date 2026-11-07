import { randomBytes } from "node:crypto";
import { MOCK_BAD_NUMBER_MARKER, MOCK_MODEL, sealSecret } from "@isms/ai";
import type { BoardNarrativeDto, BoardPackResponse, NarrativeDraftResponse } from "@isms/contracts";
import { defaultBoardPeriod, formatRiskReference } from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiModule } from "../../src/ai/index.js";
import { type ErrorBody, type Who, audits, db, detailPaths } from "../risks/harness.js";
import { reportsHarness } from "./harness.js";

const secretsKey = randomBytes(32);
const UNVERIFIABLE = "The summary uses figures that are not in the records";

describe("board narrative", () => {
  /** The services' clock: real time, moved forward by `shiftMs` (P7-R12 test). */
  const clock = { shiftMs: 0, now: () => new Date(Date.now() + clock.shiftMs) };
  const h = reportsHarness({
    imports: [AiModule.forRoot({ secretsKey, provider: "mock" })],
    clock,
  });
  beforeAll(() => h.start());
  beforeEach(async () => {
    clock.shiftMs = 0;
    await h.reset();
  });
  afterAll(() => h.stop());

  const period = defaultBoardPeriod(new Date());

  async function enableAi(enabled = true): Promise<void> {
    await db.aiSettings.create({
      data: {
        enabled,
        sealedKey: new Uint8Array(sealSecret("sk-or-test-only-narrative-0000", secretsKey)),
        keyLast4: "0000",
        keySetById: h.userIds.admin,
        keySetAt: new Date(),
        models: { conversation: MOCK_MODEL.id },
      },
    });
  }

  const draft = (who: Who = "cora", body: unknown = { period: period.key }) =>
    h.post("/api/v1/reports/board/narrative-draft", body, who);
  const approve = (text: string, interactionId: string | null, who: Who = "cora") =>
    h.put("/api/v1/reports/board/narrative", { period: period.key, text, interactionId }, who);

  /** Two above-appetite risks (one at site B, which a scoped reader would not see). */
  async function seed(title = "Payroll export") {
    const a = await h.seedRisk({ title, likelihood: 5, impact: 5, state: "approved" }, "siteA");
    await h.seedRisk({ title: "Supplier outage", likelihood: 4, impact: 4 }, "siteB");
    return a;
  }

  it("drafts through the mock within the facts, stores nothing, and approves it", async () => {
    await enableAi();
    const top = await seed();
    const res = await draft();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as NarrativeDraftResponse;
    expect(body.text).toContain("There are 2 open risks");
    expect(body.text).toContain(formatRiskReference(top.reference));
    expect(await db.aiInteraction.count({ where: { purpose: "posture_summary" } })).toBe(1);
    expect(await db.boardNarrative.count()).toBe(0);

    const approved = await approve(body.text, body.interactionId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body as BoardNarrativeDto).toMatchObject({
      text: body.text,
      approvedBy: "Cora Ciso",
      aiAssisted: true,
    });
    const row = await db.boardNarrative.findFirstOrThrow();
    expect(row).toMatchObject({
      periodKey: period.key,
      aiInteractionId: body.interactionId,
      approvedById: h.userIds.cora,
    });
    const [audit] = await audits("report.narrative_approved");
    expect(audit?.objectId).toBe(row.id);
    expect(JSON.stringify(audit?.afterRef)).not.toContain("open risks");
    expect(audit?.afterRef).toMatchObject({
      periodKey: period.key,
      aiAssisted: true,
      text: { length: body.text.length },
    });
    const pack = (await h.get(`/api/v1/reports/board?period=${period.key}`, "april"))
      .body as BoardPackResponse;
    expect(pack.narrative).toMatchObject({ text: body.text, aiAssisted: true });
  });

  it("refuses a draft with a figure not in the facts after one retry", async () => {
    await enableAi();
    await seed(`Breach ${MOCK_BAD_NUMBER_MARKER}`);
    const res = await draft();
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["narrativeUnverifiable"]);
    const rows = await db.aiInteraction.findMany({ where: { purpose: "posture_summary" } });
    expect(rows.map((r) => r.outcome)).toEqual(["rejected", "rejected"]);
    expect(rows.every((r) => r.objectType === "BoardPeriod" && r.objectId === period.key)).toBe(
      true,
    );
    expect(await db.boardNarrative.count()).toBe(0);
  });

  it("refuses an edited AI draft with a figure not in the records (400 at text)", async () => {
    await enableAi();
    await seed();
    const body = (await draft()).body as NarrativeDraftResponse;
    const res = await approve(`${body.text} Around 40 incidents happened.`, body.interactionId);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.details).toEqual([
      { path: "text", message: UNVERIFIABLE },
    ]);
    expect(await db.boardNarrative.count()).toBe(0);
  });

  it("checks a typed narrative too (P7-R5), and stores it as not AI-assisted", async () => {
    const top = await seed();
    // P7-R11: a whole reference passes, a bare reference digit does not (1 is not a fact here),
    // the period's year passes, and a day count that is not a fact fails.
    const ref = formatRiskReference(top.reference);
    expect(top.reference).toBe(1);
    expect((await approve(`${ref} is open.`, null)).status).toBe(200);
    expect((await approve("1 risk is new.", null)).status).toBe(400);
    expect(
      (await approve(`In ${period.start.slice(0, 4)} we have 2 open risks.`, null)).status,
    ).toBe(200);
    expect((await approve("Reviewed within 31 days.", null)).status).toBe(400);
    const bad = await approve("We have 37 open risks.", null);
    expect(bad.status).toBe(400);
    expect(detailPaths(bad)).toEqual(["text"]);
    const multiplier = await approve("Open risks doubled.", null);
    expect(multiplier.status).toBe(400);
    const ok = await approve("We have 2 open risks, both above appetite.", null);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body as BoardNarrativeDto).toMatchObject({ aiAssisted: false });
  });

  it("never shows a rolling period's summary once its days have moved on (P7-R12)", async () => {
    await seed();
    const body = { period: "last-30-days", text: "We have 2 open risks.", interactionId: null };
    expect((await h.put("/api/v1/reports/board/narrative", body, "cora")).status).toBe(200);
    const board = async () =>
      (await h.get("/api/v1/reports/board?period=last-30-days", "cora")).body as BoardPackResponse;
    expect((await board()).narrative).toMatchObject({ text: body.text });
    clock.shiftMs = 40 * 86_400_000;
    expect((await board()).narrative).toBeNull();
  });

  it("refuses an interaction that is not a posture summary", async () => {
    await seed();
    const other = await db.aiInteraction.create({
      data: {
        purpose: "control_suggestion",
        provider: "mock",
        model: MOCK_MODEL.id,
        routing: {},
        request: {},
        status: "ok",
        attempts: 1,
        durationMs: 1,
      },
    });
    const res = await approve("We have 2 open risks.", other.id);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["interactionId"]);
  });

  it("refuses a rejected draft and a draft of another period", async () => {
    await enableAi();
    await seed();
    const rejected = await db.aiInteraction.create({
      data: {
        purpose: "posture_summary",
        provider: "mock",
        model: MOCK_MODEL.id,
        routing: {},
        request: {},
        status: "ok",
        attempts: 1,
        durationMs: 1,
        objectType: "BoardPeriod",
        objectId: period.key,
        outcome: "rejected",
      },
    });
    const res = await approve("We have 2 open risks.", rejected.id);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["interactionId"]);
    const other = (await draft("cora", { period: "last-30-days" })).body as NarrativeDraftResponse;
    const wrong = await approve("We have 2 open risks.", other.interactionId);
    expect(wrong.status).toBe(400);
    expect(detailPaths(wrong)).toEqual(["interactionId"]);
    expect(await db.boardNarrative.count()).toBe(0);
  });

  it("gives 409 aiUnavailable when AI is off, and 400 for an unknown period", async () => {
    await enableAi(false);
    const off = await draft();
    expect(off.status).toBe(409);
    expect(detailPaths(off)).toEqual(["aiUnavailable.disabled"]);
    const typed = await approve("Fine.", null);
    expect(typed.status).toBe(200);
    const badPeriod = await h.put(
      "/api/v1/reports/board/narrative",
      { period: "1999-01", text: "Fine.", interactionId: null },
      "cora",
    );
    expect(badPeriod.status).toBe(400);
    expect(detailPaths(badPeriod)).toEqual(["period"]);
  });

  it("forbids a contributor and a site-scoped auditor", async () => {
    await enableAi();
    await h.grant("carl", "auditor", "siteA");
    for (const who of ["rita", "carl"] as const) {
      expect((await draft(who)).status).toBe(403);
      expect((await approve("Fine.", null, who)).status).toBe(403);
    }
    expect(await db.aiInteraction.count()).toBe(0);
  });
});
