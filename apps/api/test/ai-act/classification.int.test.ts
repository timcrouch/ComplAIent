import type { AiObligationDto, AiSystemDetailDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEMS,
  aiActHarness,
  audits,
  creditAnswers,
  db,
  detailPaths,
  minimalAnswers,
} from "./harness.js";

const DEPLOYER_HIGH_RISK = [
  "ai_literacy",
  "use_per_instructions",
  "assign_human_oversight",
  "input_data_quality",
  "monitor_and_report",
  "keep_logs_six_months",
  "inform_workers",
  "inform_affected_people",
  "dpia_where_required",
  "right_to_explanation",
  "fundamental_rights_impact_assessment",
];

const keys = (obligations: AiObligationDto[], applicable = true) =>
  obligations.filter((o) => o.applicable === applicable).map((o) => o.key);

describe("classifying an AI system", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.enableModule();
  });
  afterAll(() => h.stop());

  const classify = (id: string, answers: unknown, who: "cora" | "vera" = "cora") =>
    h.put(`${SYSTEMS}/${id}/classification`, { answers, interactionId: null }, who);
  const obligation = (id: string, key: string, body: unknown) =>
    h.patch(`${SYSTEMS}/${id}/obligations/${key}`, body, "cora");

  it("decides the class on the server and opens the obligations that follow", async () => {
    const { id } = await h.createSystem();
    const res = await classify(id, creditAnswers());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as AiSystemDetailDto;
    expect(body.riskClass).toBe("high_risk");
    expect(body.classification).toMatchObject({
      source: "manual",
      classifiedBy: { id: h.userIds.cora },
      result: {
        riskClass: "high_risk",
        derogationApplied: false,
        reasons: [
          { code: "annex_iii.creditworthiness", article: "Annex III, point 5(b)" },
          { code: "annex_iii.profiling", article: "Art. 6(3)" },
        ],
      },
    });
    expect(keys(body.obligations)).toEqual(DEPLOYER_HIGH_RISK);
    expect(body.obligations.every((o) => o.status === "open" && o.note === "")).toBe(true);
    expect(body.openObligationCount).toBe(DEPLOYER_HIGH_RISK.length);
    expect(body.obligations[0]).toMatchObject({ key: "ai_literacy", article: "Art. 4" });

    const [row] = await audits("ai_system.classified");
    expect(row).toMatchObject({
      objectType: "AiSystem",
      objectId: id,
      actorUserId: h.userIds.cora,
    });
    expect(row?.beforeRef).toEqual({ riskClass: "unclassified" });
    expect(row?.afterRef).toMatchObject({
      riskClass: "high_risk",
      source: "manual",
      answers: creditAnswers(),
      obligations: { added: DEPLOYER_HIGH_RISK, nowApplicable: [], nowInapplicable: [] },
    });
  });

  it("never takes a class from the client, and refuses inconsistent answers", async () => {
    const { id } = await h.createSystem();
    const withClass = await h.put(
      `${SYSTEMS}/${id}/classification`,
      { answers: creditAnswers(), interactionId: null, riskClass: "minimal_risk" },
      "cora",
    );
    expect(withClass.status).toBe(400);
    const inconsistent = await classify(id, creditAnswers({ derogation: null }));
    expect(detailPaths(inconsistent)).toEqual(["answers.derogation"]);
    expect((await db.aiSystem.findUniqueOrThrow({ where: { id } })).riskClass).toBe("unclassified");
    expect((await classify(id, creditAnswers(), "vera")).status).toBe(403);
  });

  it("keeps work on obligations that stop applying, and brings it back unchanged", async () => {
    const { id } = await h.createSystem();
    await classify(id, creditAnswers());
    await obligation(id, "inform_workers", { status: "met", note: "Works council told in May." });
    await obligation(id, "ai_literacy", { status: "in_progress" });

    const minimal = (await classify(id, minimalAnswers())).body as AiSystemDetailDto;
    expect(minimal.riskClass).toBe("minimal_risk");
    expect(keys(minimal.obligations)).toEqual(["ai_literacy"]);
    expect(keys(minimal.obligations, false)).toEqual(DEPLOYER_HIGH_RISK.slice(1));
    // Applicable first, then the flagged ones in catalogue order; nothing deleted.
    expect(minimal.obligations.map((o) => o.key)).toEqual(DEPLOYER_HIGH_RISK);
    const kept = minimal.obligations.find((o) => o.key === "inform_workers");
    expect(kept).toMatchObject({
      applicable: false,
      status: "met",
      note: "Works council told in May.",
    });
    expect(minimal.obligations[0]).toMatchObject({ key: "ai_literacy", status: "in_progress" });
    expect(minimal.openObligationCount).toBe(1);

    const again = (await classify(id, creditAnswers())).body as AiSystemDetailDto;
    expect(keys(again.obligations)).toEqual(DEPLOYER_HIGH_RISK);
    expect(again.obligations.find((o) => o.key === "inform_workers")).toMatchObject({
      applicable: true,
      status: "met",
    });
    expect(await db.aiSystemObligation.count({ where: { aiSystemId: id } })).toBe(
      DEPLOYER_HIGH_RISK.length,
    );
    const [, second, third] = await audits("ai_system.classified");
    expect(second?.afterRef).toMatchObject({
      obligations: { added: [], nowInapplicable: DEPLOYER_HIGH_RISK.slice(1) },
    });
    expect(third?.afterRef).toMatchObject({
      obligations: { added: [], nowApplicable: DEPLOYER_HIGH_RISK.slice(1) },
    });
  });

  it("re-reconciles when the role changes, keeping the deployer's work", async () => {
    const { id } = await h.createSystem();
    await classify(id, creditAnswers());
    await obligation(id, "use_per_instructions", { status: "met" });
    const res = await h.patch(`${SYSTEMS}/${id}`, { role: "importer" }, "cora");
    const body = res.body as AiSystemDetailDto;
    expect(keys(body.obligations)).toEqual(["importer_verification"]);
    expect(body.obligations.find((o) => o.key === "use_per_instructions")).toMatchObject({
      applicable: false,
      status: "met",
    });
    const [row] = await audits("ai_system.updated");
    expect(row?.afterRef).toMatchObject({
      changedFields: ["role"],
      role: "importer",
      obligations: {
        added: ["importer_verification"],
        nowApplicable: [],
        nowInapplicable: DEPLOYER_HIGH_RISK,
      },
    });
  });

  it("a role change on an unclassified system adds no obligations", async () => {
    const { id } = await h.createSystem();
    const body = (await h.patch(`${SYSTEMS}/${id}`, { role: "provider" }, "cora"))
      .body as AiSystemDetailDto;
    expect(body.obligations).toEqual([]);
    expect((await audits("ai_system.updated"))[0]?.afterRef).not.toHaveProperty("obligations");
  });

  it("updates an obligation and audits that the note changed, never its text", async () => {
    const { id } = await h.createSystem();
    await classify(id, creditAnswers());
    const note = "Ask Klaus Meier for the FRIA template";
    const res = await obligation(id, "fundamental_rights_impact_assessment", {
      status: "in_progress",
      note,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      (res.body as AiSystemDetailDto).obligations.find(
        (o) => o.key === "fundamental_rights_impact_assessment",
      ),
    ).toMatchObject({ status: "in_progress", note, updatedBy: { id: h.userIds.cora } });

    // The same values again: no audit row.
    await obligation(id, "fundamental_rights_impact_assessment", { note });
    await obligation(id, "fundamental_rights_impact_assessment", { status: "met" });
    const rows = await audits("ai_system.obligation_updated");
    expect(rows.map((r) => r.afterRef)).toEqual([
      {
        obligation: "fundamental_rights_impact_assessment",
        status: "in_progress",
        noteChanged: true,
      },
      { obligation: "fundamental_rights_impact_assessment", status: "met" },
    ]);
    expect(rows[0]?.beforeRef).toEqual({
      obligation: "fundamental_rights_impact_assessment",
      status: "open",
    });
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain("Klaus");
  });

  it("404s an obligation before classification; 400 for a key not in the catalogue", async () => {
    const { id } = await h.createSystem();
    expect((await obligation(id, "ai_literacy", { status: "met" })).status).toBe(404);
    expect((await obligation(id, "be_nice", { status: "met" })).status).toBe(400);
  });
});
