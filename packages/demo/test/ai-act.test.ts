import {
  AI_OBLIGATION_KEYS,
  applicableObligations,
  classifyAiSystem,
  formatRiskReference,
} from "@isms/domain";
import { describe, expect, it } from "vitest";
import {
  SAMPLE_AI_ACT_FRAMEWORK,
  SAMPLE_AI_SYSTEMS,
  SAMPLE_PEOPLE,
  type SampleRows,
  planSampleYear,
  rowsFor,
} from "../src/index.js";
import { NOWS, fakeLibrary } from "./helpers.js";

const library = fakeLibrary();
const build = (now: Date): SampleRows =>
  rowsFor(planSampleYear(now), {
    now,
    library,
    loader: null,
    bootstrapEmail: null,
  });

const AI_ACTIONS = [
  "organisation.module_enabled",
  "ai_system.created",
  "ai_system.classified",
  "ai_system.obligation_updated",
  "ai_system.risk_linked",
];

describe.each(NOWS)("the EU AI Act sample at %s", (iso) => {
  const now = new Date(iso);
  const rows = build(now);
  const userId = (key: string) => {
    const p = SAMPLE_PEOPLE.find((x) => x.key === key);
    return rows.users.find((u) => u.email === p?.email)?.id;
  };
  const system = (name: string) => {
    const row = rows.aiSystems.find((s) => s.name === name);
    if (!row) throw new Error(`no system ${name}`);
    return row;
  };
  const obligations = (id: string) => rows.aiSystemObligations.filter((o) => o.aiSystemId === id);
  const trail = rows.auditEvents.filter((a) => AI_ACTIONS.includes(a.action));

  it("is deterministic", () => {
    const again = build(now);
    expect(again.organisationModules).toEqual(rows.organisationModules);
    expect(again.aiSystems).toEqual(rows.aiSystems);
    expect(again.aiSystemObligations).toEqual(rows.aiSystemObligations);
    expect(again.aiSystemRisks).toEqual(rows.aiSystemRisks);
  });

  it("turns the module on, audited as the API does, and puts the AI Act in scope", () => {
    const anna = userId("anna");
    expect(rows.organisationModules).toEqual([
      {
        key: "eu_ai_act",
        enabledAt: expect.any(Date) as Date,
        enabledById: anna,
      },
    ]);
    const enabled = rows.auditEvents.filter((a) => a.action === "organisation.module_enabled");
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      actorUserId: anna,
      objectType: "OrganisationModule",
      objectId: "eu_ai_act",
      beforeRef: { enabled: false },
      afterRef: { enabled: true },
      occurredAt: rows.organisationModules[0]?.enabledAt,
    });
    const framework = rows.organisationFrameworks.find(
      (f) => f.frameworkVersionId === library.frameworkVersions[SAMPLE_AI_ACT_FRAMEWORK],
    );
    expect(framework).toMatchObject({ status: "confirmed", source: "manual" });
    expect(
      rows.auditEvents.find(
        (a) => a.action === "organisation.framework_confirmed" && a.objectId === framework?.id,
      )?.afterRef,
    ).toEqual({
      frameworkVersionKey: SAMPLE_AI_ACT_FRAMEWORK,
      status: "confirmed",
      source: "manual",
    });
  });

  it("has the four systems with the expected classes", () => {
    expect(
      rows.aiSystems.map((s) => [s.name, s.role, s.status, s.riskClass, s.classifiedById]),
    ).toEqual([
      ["Credit scoring engine", "deployer", "in_use", "high_risk", userId("carl")],
      ["Customer service chatbot", "deployer", "in_use", "limited_risk", userId("carl")],
      ["Transaction fraud detector", "deployer", "in_use", "minimal_risk", userId("carl")],
      ["CV screening tool", "deployer", "planned", "high_risk", userId("carl")],
    ]);
    expect(system("Transaction fraud detector").intendedPurpose).toContain("point 5(b)");
    for (const s of rows.aiSystems) {
      expect(s.classification).toMatchObject({ version: 1, source: "manual" });
      expect(s.nameKey).toBe(s.name.toLowerCase());
    }
  });

  it("opens exactly the obligations the domain catalogue gives, in catalogue order", () => {
    for (const sample of SAMPLE_AI_SYSTEMS) {
      const row = system(sample.profile.name);
      const result = classifyAiSystem(sample.answers);
      expect(row.classification).toEqual(
        JSON.parse(
          JSON.stringify({
            version: 1,
            answers: sample.answers,
            source: "manual",
            result,
          }),
        ),
      );
      const keys = obligations(row.id).map((o) => o.key);
      expect(keys).toEqual(applicableObligations(result, row.role, sample.answers));
      expect(
        [...keys].sort(
          (a, b) => AI_OBLIGATION_KEYS.indexOf(a as never) - AI_OBLIGATION_KEYS.indexOf(b as never),
        ),
      ).toEqual(keys);
      expect(obligations(row.id).every((o) => o.applicable)).toBe(true);
    }
    const credit = obligations(system("Credit scoring engine").id);
    expect(credit.map((o) => o.key)).toContain("fundamental_rights_impact_assessment");
    expect(credit.some((o) => o.status === "met")).toBe(true);
    expect(credit.some((o) => o.status === "in_progress")).toBe(true);
    const cv = obligations(system("CV screening tool").id);
    expect(cv.length).toBeGreaterThan(5);
    expect(cv.every((o) => o.status === "open" && o.note === "")).toBe(true);
    expect(obligations(system("Customer service chatbot").id).map((o) => o.key)).toEqual([
      "ai_literacy",
    ]);
  });

  it("links the credit scoring engine to a fitting sample risk reported before the link", () => {
    expect(rows.aiSystemRisks).toHaveLength(1);
    const [link] = rows.aiSystemRisks;
    const risk = rows.risks.find((r) => r.id === link?.riskId);
    const titles = SAMPLE_AI_SYSTEMS[0]?.linkRisk?.titles ?? [];
    expect(link?.aiSystemId).toBe(system("Credit scoring engine").id);
    expect(titles).toContain(risk?.title);
    expect(risk?.createdAt.getTime()).toBeLessThan(link?.linkedAt.getTime() ?? 0);
    const audit = rows.auditEvents.find((a) => a.action === "ai_system.risk_linked");
    expect(audit?.afterRef).toEqual({
      riskId: risk?.id,
      riskReference: formatRiskReference(risk?.reference ?? 0),
    });
  });

  it("audits every obligation change from the status before, never with the note's text", () => {
    const updates = trail.filter((a) => a.action === "ai_system.obligation_updated");
    expect(updates).toHaveLength(SAMPLE_AI_SYSTEMS.reduce((n, s) => n + s.work.length, 0));
    const status = new Map<string, unknown>();
    for (const u of updates) {
      const before = u.beforeRef as { obligation: string; status: string };
      const after = u.afterRef as {
        obligation: string;
        status: string;
        noteChanged?: true;
      };
      const at = `${u.objectId} ${before.obligation}`;
      expect(before.status).toBe(status.get(at) ?? "open");
      expect(after).toEqual({
        obligation: before.obligation,
        status: after.status,
        noteChanged: true,
      });
      status.set(at, after.status);
    }
    const notes = rows.aiSystemObligations.map((o) => o.note).filter((n) => n !== "");
    const text = JSON.stringify(trail);
    for (const note of notes) expect(text).not.toContain(note);
    // Free text is recorded by length only.
    for (const c of trail.filter((a) => a.action === "ai_system.created"))
      expect((c.afterRef as Record<string, unknown>)["intendedPurpose"]).toEqual({
        changed: true,
        length: expect.any(Number) as number,
      });
  });

  it("happens in order, after setup and before today, with each system's steps in sequence", () => {
    const setup = rows.organisation[0]?.createdAt.getTime() ?? 0;
    const today0 = Math.floor(now.getTime() / 86_400_000) * 86_400_000;
    for (const a of trail) {
      expect(a.occurredAt.getTime()).toBeGreaterThan(setup);
      expect(a.occurredAt.getTime()).toBeLessThan(today0);
    }
    const times = trail.map((a) => a.occurredAt.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    const module = rows.organisationModules[0]?.enabledAt.getTime() ?? 0;
    for (const s of rows.aiSystems) {
      expect(s.createdAt.getTime()).toBeGreaterThan(module);
      expect(s.classifiedAt?.getTime()).toBeGreaterThan(s.createdAt.getTime());
      expect(
        trail
          .filter((a) => a.objectId === s.id)
          .map((a) => a.action)
          .slice(0, 2),
      ).toEqual(["ai_system.created", "ai_system.classified"]);
    }
  });
});
