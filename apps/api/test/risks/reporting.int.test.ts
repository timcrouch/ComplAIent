import type { ReportRiskInput, RiskDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/identity/index.js";
import { RiskReportService } from "../../src/risks/index.js";
import { type Who, db, reportBody, risksHarness } from "./harness.js";

describe("reporting: scoped reporters and AI-assisted reports", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const actor = (who: Who): Actor => ({
    userId: h.userIds[who],
    email: `${who}@example.test`,
    authTime: 0,
    authTimeSource: "auth_time",
    roles: [{ role: "contributor", scope: { type: "organisation", id: null } }],
  });
  const ctx = (who: Who) => ({ actorUserId: h.userIds[who], requestId: "test-request" });
  const conversation = (who: Who) =>
    db.concernConversation.create({ data: { reporterId: h.userIds[who], toConfirm: [] } });
  const input = reportBody() as ReportRiskInput;
  const estimate = { likelihood: 3, impact: 4, reasoning: "Estimated from the description." };

  it("a site-scoped contributor may report about any site and list their concerns", async () => {
    const me = await h.get("/api/v1/me", "sam");
    expect((me.body as { permissions: string[] }).permissions).toContain("risks.report");
    const res = await h.post("/api/v1/risks", reportBody({ siteId: h.sites.siteB }), "sam");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const concerns = await h.get("/api/v1/me/concerns", "sam");
    expect(concerns.status).toBe(200);
    expect((concerns.body as { items: { id: string }[] }).items.map((c) => c.id)).toEqual([
      (res.body as RiskDetailDto).id,
    ]);
  });

  it("queues evaluation only when the organisation has opted into concern rewards", async () => {
    const ordinary = await h.post("/api/v1/risks", reportBody(), "rita");
    expect(ordinary.status).toBe(201);
    expect(await db.concernEvaluation.count()).toBe(0);

    await db.organisation.create({
      data: {
        name: "Northwind",
        description: "",
        concernRewardsEnabled: true,
      },
    });
    const rewarded = await h.post(
      "/api/v1/risks",
      reportBody({ title: "Suspicious sign-in prompt" }),
      "rita",
    );
    expect(rewarded.status, JSON.stringify(rewarded.body)).toBe(201);
    const evaluation = await db.concernEvaluation.findFirstOrThrow({
      where: { riskId: (rewarded.body as RiskDetailDto).id },
    });
    expect(evaluation).toMatchObject({
      reporterId: h.userIds.rita,
      status: "pending",
      source: null,
      totalPoints: 0,
    });
    expect(
      await db.auditEvent.count({
        where: { action: "concern.evaluation_queued", objectId: evaluation.id },
      }),
    ).toBe(1);
  });

  it("an AI-assisted report submits and links the reporter's open conversation", async () => {
    const open = await conversation("rita");
    const reports = h.service(RiskReportService);
    const risk = await reports.report(actor("rita"), input, ctx("rita"), {
      aiAssisted: true,
      conversationId: open.id,
      aiEstimate: estimate,
    });
    expect(risk).toMatchObject({
      aiAssisted: true,
      hasTranscript: true,
      aiEstimate: estimate,
      likelihood: null,
      impact: null,
    });
    expect(
      await db.concernConversation.findUniqueOrThrow({ where: { id: open.id } }),
    ).toMatchObject({ status: "submitted", riskId: risk.id });
  });

  it("a conversation already submitted, or someone else's, is 409 conversationClosed", async () => {
    const reports = h.service(RiskReportService);
    const opts = (conversationId: string) =>
      ({ aiAssisted: true, conversationId, aiEstimate: null }) as const;
    const open = await conversation("rita");
    await reports.report(actor("rita"), input, ctx("rita"), opts(open.id));
    const closed = expect.objectContaining({
      code: "CONFLICT",
      details: [{ path: "conversationClosed", message: "conversationClosed" }],
    }) as unknown;
    await expect(reports.report(actor("rita"), input, ctx("rita"), opts(open.id))).rejects.toEqual(
      closed,
    );
    const carls = await conversation("carl");
    await expect(reports.report(actor("rita"), input, ctx("rita"), opts(carls.id))).rejects.toEqual(
      closed,
    );
    // Nothing of the refused reports was kept.
    expect(await db.risk.count()).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "risk.reported" } })).toBe(1);
  });
});
