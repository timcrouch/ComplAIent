import type { SoaResponse, SoaRowDto } from "@isms/contracts";
import { formatRiskReference } from "@isms/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db } from "../risks/harness.js";
import { control, reportsHarness } from "./harness.js";

describe("Statement of Applicability", () => {
  const h = reportsHarness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  const ids = { a51: "", a813: "", a815: "", art32: "" };
  const refs = { riga: "", berlin: "" };

  /** A framework version with requirements; returns the version id and requirement ids by ref. */
  async function framework(
    key: string,
    name: string,
    versionKey: string,
    reqs: { ref: string; fullText?: string }[],
  ) {
    const fw = await db.framework.create({
      data: { key, name, publisher: "P", summary: "S" },
    });
    const version = await db.frameworkVersion.create({
      data: { frameworkId: fw.id, key: versionKey, label: "2022" },
    });
    const out: Record<string, string> = {};
    for (const [i, r] of reqs.entries())
      out[r.ref] = (
        await db.requirement.create({
          data: {
            frameworkVersionId: version.id,
            ref: r.ref,
            title: `Paraphrase of ${r.ref}`,
            fullText: r.fullText ?? null,
            sortOrder: i,
          },
        })
      ).id;
    return { versionId: version.id, reqs: out };
  }

  const confirm = (frameworkVersionId: string, status: "confirmed" | "suggested" = "confirmed") =>
    db.organisationFramework.create({
      data: {
        frameworkVersionId,
        status,
        source: "manual",
        ...(status === "confirmed"
          ? { confirmedById: h.userIds.cora, confirmedAt: new Date() }
          : {}),
      },
    });

  const map = (controlId: string, requirementId: string) =>
    db.controlRequirementMapping.create({ data: { controlId, requirementId } });

  const accept = (
    riskId: string,
    controlId: string,
    status: "accepted" | "suggested" = "accepted",
  ) => db.riskControl.create({ data: { riskId, controlId, status, source: "person" } });

  const test = (controlId: string, result: "effective" | "ineffective", testedOn: string) =>
    db.controlTest.create({
      data: {
        controlId,
        result,
        testedOn: new Date(`${testedOn}T00:00:00Z`),
        method: "Looked",
        testedById: h.userIds.cora,
      },
    });

  beforeEach(async () => {
    await h.reset();
    await h.grant("carl", "auditor", "siteA");
    // GDPR is confirmed first: ISO 27001 must still be the default.
    const gdpr = await framework("gdpr", "GDPR", "gdpr-2016-679", [{ ref: "Art. 32" }]);
    const iso = await framework("iso27001", "ISO/IEC 27001", "iso27001-2022", [
      { ref: "A.5.1" },
      { ref: "A.8.13" },
      { ref: "A.8.15", fullText: "Licensed text" },
    ]);
    ids.a51 = iso.reqs["A.5.1"] ?? "";
    ids.a813 = iso.reqs["A.8.13"] ?? "";
    ids.a815 = iso.reqs["A.8.15"] ?? "";
    ids.art32 = gdpr.reqs["Art. 32"] ?? "";
    const gov = await control("GOV-01", "Rules"); // accepted, never tested
    const res = await control("RES-01", "Backups"); // accepted in Berlin, latest test effective
    const log = await control("LOG-01", "Logging"); // accepted in Riga, latest test ineffective
    const acc = await control("ACC-01", "Access"); // only suggested: not implemented
    await map(gov, ids.a51);
    await map(res, ids.a813);
    await map(log, ids.a813);
    await map(acc, ids.a815);
    await map(res, ids.art32);
    const riga = await h.seedRisk({ title: "Riga" }, "siteA");
    const berlin = await h.seedRisk({ title: "Berlin" }, "siteB");
    refs.riga = formatRiskReference(riga.reference);
    refs.berlin = formatRiskReference(berlin.reference);
    await accept(riga.id, gov);
    await accept(riga.id, log);
    await accept(riga.id, acc, "suggested");
    await accept(berlin.id, res);
    await test(res, "ineffective", "2026-09-01");
    await test(res, "effective", "2026-10-01");
    await test(log, "effective", "2026-09-01");
    await test(log, "ineffective", "2026-10-01");
    await confirm(gdpr.versionId);
    await confirm(iso.versionId);
  });

  const soa = async (who: Parameters<typeof h.get>[1], query = "") => {
    const res = await h.get(`/api/v1/reports/soa${query}`, who);
    return { status: res.status, body: res.body as SoaResponse };
  };
  const row = (body: SoaResponse, ref: string) => body.rows.find((r) => r.ref === ref) as SoaRowDto;

  it("defaults to ISO 27001 with statuses, hints and visible risk references", async () => {
    const { status, body } = await soa("cora");
    expect(status).toBe(200);
    expect(body.framework).toEqual({
      key: "iso27001-2022",
      name: "ISO/IEC 27001",
      versionLabel: "2022",
    });
    expect(body.frameworks.map((f) => f.key).sort()).toEqual(["gdpr-2016-679", "iso27001-2022"]);
    expect(body.canManage).toBe(true);
    expect(body.scope).toEqual({ kind: "organisation" });
    expect(body.rows.map((r) => r.ref)).toEqual(["A.5.1", "A.8.13", "A.8.15"]);
    expect(row(body, "A.5.1")).toEqual({
      requirementId: ids.a51,
      ref: "A.5.1",
      title: "Paraphrase of A.5.1",
      fullText: null,
      decision: null,
      hint: { kind: "used", refs: [refs.riga], hiddenCount: 0 },
      controls: [{ code: "GOV-01", title: "Rules", status: "implementedNotTested" }],
      riskRefs: [refs.riga],
      groupKey: null,
    });
    // This test library's ISO 27001 has no groups: the SoA stays flat.
    expect(body.groups).toEqual([]);
    expect(row(body, "A.8.13").controls).toEqual([
      { code: "LOG-01", title: "Logging", status: "implementedIneffective" },
      { code: "RES-01", title: "Backups", status: "implementedTested" },
    ]);
    expect(row(body, "A.8.13").riskRefs).toEqual([refs.riga, refs.berlin]);
    expect(row(body, "A.8.13").hint).toEqual({
      kind: "used",
      refs: [refs.riga, refs.berlin],
      hiddenCount: 0,
    });
    expect(row(body, "A.8.15")).toMatchObject({
      fullText: "Licensed text",
      hint: { kind: "unused" },
      controls: [{ code: "ACC-01", status: "notImplemented" }],
      riskRefs: [],
    });
  });

  it("shows a site auditor only the risks they may see, with statuses from every risk", async () => {
    const { status, body } = await soa("carl");
    expect(status).toBe(200);
    expect(body.canManage).toBe(false);
    expect(body.scope).toEqual({ kind: "units", names: ["Riga"] });
    expect(row(body, "A.8.13").riskRefs).toEqual([refs.riga]);
    // P7-R9: the Berlin use is counted, not named, so the hint agrees with the status.
    expect(row(body, "A.8.13").hint).toEqual({ kind: "used", refs: [refs.riga], hiddenCount: 1 });
    expect(row(body, "A.8.15").hint).toEqual({ kind: "unused" });
    expect(row(body, "A.8.13").controls.map((c) => c.status)).toEqual([
      "implementedIneffective",
      "implementedTested",
    ]);
    const gdpr = await soa("carl", "?framework=gdpr-2016-679");
    expect(gdpr.body.framework?.key).toBe("gdpr-2016-679");
    expect(gdpr.body.rows).toHaveLength(1);
    expect(gdpr.body.rows[0]).toMatchObject({
      ref: "Art. 32",
      riskRefs: [],
      hint: { kind: "used", refs: [], hiddenCount: 1 },
      controls: [{ code: "RES-01", title: "Backups", status: "implementedTested" }],
    });
  });

  it("is empty when no framework is confirmed, and 404 for an unconfirmed key", async () => {
    await db.organisationFramework.deleteMany({});
    const { status, body } = await soa("cora");
    expect(status).toBe(200);
    expect(body).toMatchObject({ frameworks: [], framework: null, rows: [] });
    expect((await soa("cora", "?framework=iso27001-2022")).status).toBe(404);
  });

  it("falls back to the first confirmed framework without ISO 27001", async () => {
    await db.organisationFramework.deleteMany({});
    const gdpr = await db.frameworkVersion.findUniqueOrThrow({ where: { key: "gdpr-2016-679" } });
    const iso = await db.frameworkVersion.findUniqueOrThrow({ where: { key: "iso27001-2022" } });
    await confirm(iso.id, "suggested");
    await confirm(gdpr.id);
    const { body } = await soa("cora");
    expect(body.framework?.key).toBe("gdpr-2016-679");
    expect(body.frameworks).toHaveLength(1);
  });

  it("lets the CISO set applicability, audited with before and after", async () => {
    const path = `/api/v1/reports/soa/${ids.a51}`;
    const first = await h.put(
      path,
      { applicable: false, justification: "  Not in scope " },
      "cora",
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((first.body as SoaRowDto).decision).toMatchObject({
      applicable: false,
      justification: "Not in scope",
      decidedBy: "Cora Ciso",
    });
    const second = await h.put(path, { applicable: true, justification: "Needed" }, "cora");
    expect(second.status).toBe(200);
    const events = await audits("soa.applicability_set");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      objectType: "requirement",
      objectId: ids.a51,
      actorUserId: h.userIds.cora,
      beforeRef: null,
      afterRef: { applicable: false, justification: { length: 12 } },
    });
    expect(events[1]).toMatchObject({
      beforeRef: { applicable: false, justification: { length: 12 } },
      afterRef: { applicable: true, justification: { length: 6 } },
    });
    const { body } = await soa("cora");
    expect(row(body, "A.5.1").decision).toMatchObject({
      applicable: true,
      justification: "Needed",
    });
  });

  it("refuses an auditor (403), an unknown requirement (404) and an empty justification (400)", async () => {
    const body = { applicable: true, justification: "Yes" };
    expect((await h.put(`/api/v1/reports/soa/${ids.a51}`, body, "aldo")).status).toBe(403);
    const unknown = "0190a000-0000-7000-8000-000000000000";
    expect((await h.put(`/api/v1/reports/soa/${unknown}`, body, "cora")).status).toBe(404);
    const empty = { applicable: true, justification: "  " };
    expect((await h.put(`/api/v1/reports/soa/${ids.a51}`, empty, "cora")).status).toBe(400);
    expect(await audits("soa.applicability_set")).toHaveLength(0);
  });

  it("groups a framework's rows by Function and Category, with decided-of-total counts", async () => {
    const fw = await db.framework.create({
      data: { key: "nist-csf", name: "NIST CSF", publisher: "NIST", summary: "S" },
    });
    const version = await db.frameworkVersion.create({
      data: { frameworkId: fw.id, key: "nist-csf-2.0", label: "2.0" },
    });
    const group = (key: string, title: string, sortOrder: number, parentId: string | null) =>
      db.requirementGroup.create({
        data: { frameworkVersionId: version.id, key, title, sortOrder, parentId },
      });
    const gv = await group("GV", "Govern", 0, null);
    const oc = await group("GV.OC", "Organisational context", 1, gv.id);
    const rm = await group("GV.RM", "Risk management strategy", 2, gv.id);
    // A group without requirements (for example one the content dropped) is left out.
    await group("GV.XX", "Dropped", 3, gv.id);
    const id = await group("ID", "Identify", 4, null);
    const am = await group("ID.AM", "Asset management", 5, id.id);
    const reqIds: Record<string, string> = {};
    for (const [i, [ref, groupId]] of (
      [
        ["GV.OC-01", oc.id],
        ["GV.OC-02", oc.id],
        ["GV.RM-01", rm.id],
        ["ID.AM-01", am.id],
      ] as const
    ).entries())
      reqIds[ref] = (
        await db.requirement.create({
          data: { frameworkVersionId: version.id, ref, title: `T ${ref}`, sortOrder: i, groupId },
        })
      ).id;
    // A requirement the content no longer lists keeps no group (sync never deletes).
    await db.requirement.create({
      data: { frameworkVersionId: version.id, ref: "OLD-01", title: "T OLD-01", sortOrder: 9 },
    });
    await confirm(version.id);

    const decide = (ref: string) =>
      h.put(
        `/api/v1/reports/soa/${reqIds[ref] ?? ""}`,
        { applicable: true, justification: "Yes" },
        "cora",
      );
    const decided = await decide("GV.OC-01");
    expect((decided.body as SoaRowDto).groupKey).toBe("GV.OC");
    await decide("ID.AM-01");

    const { status, body } = await soa("cora", "?framework=nist-csf-2.0");
    expect(status).toBe(200);
    expect(body.groups).toEqual([
      { key: "GV", title: "Govern", parentKey: null, decided: 1, total: 3 },
      { key: "GV.OC", title: "Organisational context", parentKey: "GV", decided: 1, total: 2 },
      { key: "GV.RM", title: "Risk management strategy", parentKey: "GV", decided: 0, total: 1 },
      { key: "ID", title: "Identify", parentKey: null, decided: 1, total: 1 },
      { key: "ID.AM", title: "Asset management", parentKey: "ID", decided: 1, total: 1 },
      { key: "_other", title: "Other requirements", parentKey: null, decided: 0, total: 1 },
    ]);
    expect(body.rows.map((r) => [r.ref, r.groupKey])).toEqual([
      ["GV.OC-01", "GV.OC"],
      ["GV.OC-02", "GV.OC"],
      ["GV.RM-01", "GV.RM"],
      ["ID.AM-01", "ID.AM"],
      ["OLD-01", "_other"],
    ]);
    // A flat framework next to it still has no groups.
    const gdpr = await soa("cora", "?framework=gdpr-2016-679");
    expect(gdpr.body.groups).toEqual([]);
    expect(gdpr.body.rows.every((r) => r.groupKey === null)).toBe(true);
  });

  it("refuses a contributor", async () => {
    expect((await soa("rita")).status).toBe(403);
  });
});
