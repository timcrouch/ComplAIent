import { loadLibrary } from "@isms/control-library";
import type { AiSystemDetailDto } from "@isms/contracts";
import {
  type LibraryIds,
  SAMPLE_AI_SYSTEMS,
  SAMPLE_DEPARTMENTS,
  SAMPLE_PEOPLE,
  type SampleRows,
  planSampleYear,
  rowsFor,
} from "@isms/demo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEMS, aiActHarness, db } from "../ai-act/harness.js";

/** Library ids for the shipped content, fake but stable: rowsFor needs one per code and ref. */
function fakeLibrary(): LibraryIds {
  const lib = loadLibrary();
  let n = 0;
  const id = () => {
    n += 1;
    return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  };
  return {
    frameworkVersions: Object.fromEntries(lib.frameworks.map((f) => [f.version.key, id()])),
    controls: Object.fromEntries(lib.controls.map((c) => [c.code, id()])),
    requirements: Object.fromEntries(
      lib.frameworks.flatMap((f) => f.requirements.map((r) => [`${f.version.key} ${r.ref}`, id()])),
    ),
  };
}

type Audit = { action: string; beforeRef: unknown; afterRef: unknown };

/**
 * An audit row with the ids that differ between the two databases replaced by their roles. An
 * absent snapshot is NULL in the database, as createMany writes it.
 */
const normalise = (a: Audit, ids: Map<string, string>) =>
  JSON.parse(
    JSON.stringify(
      {
        action: a.action,
        before: a.beforeRef ?? null,
        after: a.afterRef ?? null,
      },
      (_, v: unknown) =>
        typeof v === "string" ? (ids.get(v) ?? v.replace(/^R-\d{4}$/, "<reference>")) : v,
    ),
  ) as unknown;

describe("sample EU AI Act rows match the API (audit parity)", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  it("writes the same module, register and obligation rows and audit payloads", async () => {
    const now = new Date("2026-11-06T10:15:00.000Z");
    const rows: SampleRows = rowsFor(planSampleYear(now), {
      now,
      library: fakeLibrary(),
      loader: null,
      bootstrapEmail: null,
    });
    const sampleUser = (key: string) =>
      rows.users.find((u) => u.email === SAMPLE_PEOPLE.find((p) => p.key === key)?.email)?.id ?? "";
    const sampleDepartment = (key: string) =>
      rows.departments[SAMPLE_DEPARTMENTS.findIndex((d) => d.key === key)]?.id ?? "";

    // The module switch, through the API.
    const on = await h.put("/api/v1/organisation/modules/eu_ai_act", { enabled: true }, "admin");
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const [apiModule] = await db.auditEvent.findMany({
      where: { action: "organisation.module_enabled" },
    });
    const demoModule = rows.auditEvents.find((a) => a.action === "organisation.module_enabled");
    expect(apiModule && normalise(apiModule, new Map())).toEqual(
      demoModule && normalise(demoModule as Audit, new Map()),
    );

    for (const sample of SAMPLE_AI_SYSTEMS) {
      const demo = rows.aiSystems.find((s) => s.name === sample.profile.name);
      if (!demo) throw new Error(`no sample system ${sample.profile.name}`);
      const department = sample.profile.department ?? "";
      const dept = await db.department.create({
        data: { name: department, nameKey: department },
      });
      const ids = new Map([
        [sampleUser(sample.profile.owner), "<owner>"],
        [h.userIds.cora, "<owner>"],
        [sampleDepartment(department), "<department>"],
        [dept.id, "<department>"],
      ]);

      // Replay the sample's steps through the API, in the sample's order.
      const p = sample.profile;
      const created = await h.post(
        SYSTEMS,
        {
          name: p.name,
          description: p.description,
          intendedPurpose: p.intendedPurpose,
          role: p.role,
          supplier: p.supplier,
          model: p.model,
          usesGeneralPurposeModel: p.usesGeneralPurposeModel,
          status: p.status,
          ownerId: h.userIds.cora,
          departmentId: dept.id,
        },
        "cora",
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = (created.body as AiSystemDetailDto).id;
      const classified = await h.put(
        `${SYSTEMS}/${id}/classification`,
        { answers: sample.answers, interactionId: null },
        "cora",
      );
      expect(classified.status, JSON.stringify(classified.body)).toBe(200);
      const steps = [
        ...(sample.linkRisk ? [{ daysAgo: sample.linkRisk.daysAgo, link: true as const }] : []),
        ...sample.work.map((w) => ({ ...w, link: false as const })),
      ].sort((x, y) => y.daysAgo - x.daysAgo);
      for (const step of steps) {
        if (step.link) {
          const demoLink = rows.aiSystemRisks.find((l) => l.aiSystemId === demo.id);
          const title = rows.risks.find((r) => r.id === demoLink?.riskId)?.title ?? "";
          const riskId = await h.insertRisk(title, { state: "approved" });
          ids.set(riskId, "<risk>").set(demoLink?.riskId ?? "", "<risk>");
          const res = await h.post(`${SYSTEMS}/${id}/risks`, { riskId }, "cora");
          expect(res.status, JSON.stringify(res.body)).toBe(201);
        } else {
          const res = await h.patch(
            `${SYSTEMS}/${id}/obligations/${step.obligation}`,
            { status: step.status, note: step.note },
            "cora",
          );
          expect(res.status, JSON.stringify(res.body)).toBe(200);
        }
      }

      const api = await db.auditEvent.findMany({
        where: { objectId: id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      const sampleTrail = rows.auditEvents
        .filter((a) => a.objectId === demo.id)
        .sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
      expect(api.map((a) => normalise(a, ids))).toEqual(
        sampleTrail.map((a) => normalise(a as Audit, ids)),
      );

      // The stored rows: the classification JSON and the obligations.
      const stored = await db.aiSystem.findUniqueOrThrow({
        where: { id },
        include: { obligations: true },
      });
      expect(stored.classification).toEqual(demo.classification);
      expect(stored.riskClass).toBe(demo.riskClass);
      const pick = (o: { key: string; applicable: boolean; status?: string; note?: string }) => ({
        key: o.key,
        applicable: o.applicable,
        status: o.status,
        note: o.note,
      });
      expect(stored.obligations.map(pick).sort((a, b) => a.key.localeCompare(b.key))).toEqual(
        rows.aiSystemObligations
          .filter((o) => o.aiSystemId === demo.id)
          .map(pick)
          .sort((a, b) => a.key.localeCompare(b.key)),
      );
    }
  });
});
