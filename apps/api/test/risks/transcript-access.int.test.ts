import type { RiskDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Who, db, reportBody, risksHarness } from "./harness.js";

describe("can.readTranscript follows the transcript route's rule", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  async function report(who: Who, overrides: Record<string, unknown> = {}) {
    const res = await h.post("/api/v1/risks", reportBody(overrides), who);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as RiskDetailDto;
  }
  const withConversation = async (who: Who, overrides: Record<string, unknown> = {}) => {
    const risk = await report(who, overrides);
    await db.concernConversation.create({
      data: { reporterId: h.userIds[who], toConfirm: [], riskId: risk.id, status: "submitted" },
    });
    return risk;
  };
  const readTranscript = async (id: string, who: Who) => {
    const res = await h.get(`/api/v1/risks/${id}`, who);
    expect(res.status).toBe(200);
    return (res.body as RiskDetailDto).can.readTranscript;
  };

  it("the reporter and ai.transcripts.read holders who see the risk; never without a conversation", async () => {
    const risk = await withConversation("rita", { siteId: h.sites.siteA });
    expect(await readTranscript(risk.id, "cora")).toBe(true); // ciso: ai.transcripts.read
    expect(await readTranscript(risk.id, "aldo")).toBe(true); // auditor: ai.transcripts.read
    expect(await readTranscript(risk.id, "oscar")).toBe(false); // risk owner sees it, no permission
    expect(await readTranscript(risk.id, "april")).toBe(false);

    // A risk_owner reporter reads their own transcript.
    const own = await withConversation("oscar", { siteId: h.sites.siteA });
    expect(await readTranscript(own.id, "oscar")).toBe(true);

    const plain = await report("rita");
    expect(await readTranscript(plain.id, "cora")).toBe(false);
    expect(await readTranscript(plain.id, "aldo")).toBe(false);
  });
});
