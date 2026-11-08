import { MOCK_AI_ACT_RATIONALE, MOCK_INVALID_MARKER } from "@isms/ai";
import type {
  AiClassificationDraftResponse,
  AiObligationGuidanceResponse,
  AiSystemDetailDto,
} from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEMS, aiActHarness, audits, creditAnswers, db, detailPaths } from "./harness.js";

describe("AI assistance in the AI Act module", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.enableModule();
  });
  afterAll(() => h.stop());

  const draft = (id: string, who: "cora" | "vera" = "cora") =>
    h.post(`${SYSTEMS}/${id}/classification/draft`, {}, who);
  const guidance = (id: string, key = "fundamental_rights_impact_assessment") =>
    h.post(`${SYSTEMS}/${id}/obligations/${key}/guidance`, {}, "cora");
  const save = (id: string, interactionId: string | null, answers: unknown = creditAnswers()) =>
    h.put(`${SYSTEMS}/${id}/classification`, { answers, interactionId }, "cora");

  it("drafts answers from the profile only, recorded as an interaction", async () => {
    await h.enableAi();
    const { id } = await h.createSystem({ ownerId: h.userIds.olga });
    const riskId = await h.insertRisk("Secret risk title");
    await h.post(`${SYSTEMS}/${id}/risks`, { riskId }, "cora");
    const res = await draft(id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as AiClassificationDraftResponse;
    expect(body.answers).toEqual(creditAnswers());
    expect(body.rationales.annexIIIAreas).toBe(MOCK_AI_ACT_RATIONALE);
    const interaction = await db.aiInteraction.findUniqueOrThrow({
      where: { id: body.interactionId },
    });
    expect(interaction).toMatchObject({
      purpose: "ai_act_classification",
      status: "ok",
      outcome: "pending",
      actorUserId: h.userIds.cora,
      objectType: "AiSystem",
      objectId: id,
    });
    const sent = JSON.stringify(interaction.request);
    expect(sent).toContain("Credit scoring engine");
    for (const absent of ["Olga", "olga@example.test", "Secret risk title", "Cora"])
      expect(sent).not.toContain(absent);
    // Nothing is saved until a person saves.
    expect((await db.aiSystem.findUniqueOrThrow({ where: { id } })).riskClass).toBe("unclassified");
  });

  it("saves a reviewed draft as ai_assisted and marks the draft accepted", async () => {
    await h.enableAi();
    const { id } = await h.createSystem();
    const { interactionId, answers } = (await draft(id)).body as AiClassificationDraftResponse;
    const res = await save(id, interactionId, {
      ...answers,
      transparency: ["interacts_with_people"],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as AiSystemDetailDto).classification?.source).toBe("ai_assisted");
    expect((await audits("ai_system.classified"))[0]?.afterRef).toMatchObject({
      source: "ai_assisted",
    });
    const interaction = await db.aiInteraction.findUniqueOrThrow({ where: { id: interactionId } });
    expect(interaction.outcome).toBe("accepted");
  });

  it("refuses an interaction that is not a draft of this system (400)", async () => {
    await h.enableAi();
    const one = await h.createSystem();
    const other = await h.createSystem({ name: "Other system" });
    const { interactionId } = (await draft(one.id)).body as AiClassificationDraftResponse;
    expect(detailPaths(await save(other.id, interactionId))).toEqual(["interactionId"]);
    expect(detailPaths(await save(other.id, "0190a6f2-0000-7000-8000-0000000000ab"))).toEqual([
      "interactionId",
    ]);
  });

  it("suggests steps for an obligation from the profile and the obligation only", async () => {
    await h.enableAi();
    const { id } = await h.createSystem();
    await save(id, null);
    await h.patch(
      `${SYSTEMS}/${id}/obligations/fundamental_rights_impact_assessment`,
      { note: "Private working note" },
      "cora",
    );
    const res = await guidance(id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as AiObligationGuidanceResponse;
    expect(body.steps.length).toBeGreaterThanOrEqual(3);
    expect(body.steps.join(" ")).toContain("Art. 27");
    expect(body.evidenceHint).not.toBeNull();
    const interaction = await db.aiInteraction.findUniqueOrThrow({
      where: { id: body.interactionId },
    });
    expect(interaction).toMatchObject({ purpose: "ai_act_obligation_guidance", objectId: id });
    const sent = JSON.stringify(interaction.request);
    expect(sent).toContain("Risk class: high_risk");
    expect(sent).not.toContain("Private working note");
    expect(sent).not.toContain("Oscar");
    // The note is untouched: nothing is stored until a person saves.
    const row = await db.aiSystemObligation.findFirstOrThrow({
      where: { aiSystemId: id, key: "fundamental_rights_impact_assessment" },
    });
    expect(row.note).toBe("Private working note");
  });

  it("404s guidance for an obligation the system does not have", async () => {
    await h.enableAi();
    const { id } = await h.createSystem();
    expect((await guidance(id)).status).toBe(404);
    await save(id, null);
    expect((await guidance(id, "importer_verification")).status).toBe(404);
  });

  it("gives 409 aiUnavailable when AI is off, and offers no AI buttons", async () => {
    await h.enableAi(false);
    const { id } = await h.createSystem();
    await save(id, null);
    const off = await draft(id);
    expect(off.status).toBe(409);
    expect(detailPaths(off)).toEqual(["aiUnavailable.disabled"]);
    expect(detailPaths(await guidance(id))).toEqual(["aiUnavailable.disabled"]);
    const detail = (await h.get(`${SYSTEMS}/${id}`, "cora")).body as AiSystemDetailDto;
    expect(detail).toMatchObject({ canDraftClassification: false, canSuggestGuidance: false });
    expect(await db.aiInteraction.count()).toBe(0);
  });

  it("offers the AI buttons only to managers when AI is ready", async () => {
    await h.enableAi();
    const { id } = await h.createSystem();
    const as = async (who: "cora" | "vera") =>
      (await h.get(`${SYSTEMS}/${id}`, who)).body as AiSystemDetailDto;
    expect(await as("cora")).toMatchObject({
      canDraftClassification: true,
      canSuggestGuidance: true,
    });
    expect(await as("vera")).toMatchObject({
      canDraftClassification: false,
      canSuggestGuidance: false,
    });
    expect((await draft(id, "vera")).status).toBe(403);
  });

  it("gives 409 aiUnavailable.invalidOutput when the output fails the schema", async () => {
    await h.enableAi();
    const { id } = await h.createSystem({ description: `Scores loans ${MOCK_INVALID_MARKER}` });
    const res = await draft(id);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.invalidOutput"]);
    const [interaction] = await db.aiInteraction.findMany();
    expect(interaction?.status).toBe("invalid_output");
  });
});
