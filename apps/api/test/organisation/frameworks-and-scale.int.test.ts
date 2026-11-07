import type { FrameworksResponse, OrganisationResponse, RiskScaleDto } from "@isms/contracts";
import { syncControlLibrary } from "@isms/control-library";
import { FIXTURE_LIBRARY } from "@isms/control-library/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths, organisationHarness } from "./harness.js";

describe("organisation frameworks and risk scale", () => {
  const h = organisationHarness();
  const versionIds = {} as Record<"iso" | "gdpr", string>;
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await syncControlLibrary(db, FIXTURE_LIBRARY);
    for (const [name, key] of [
      ["iso", "iso27001-2022"],
      ["gdpr", "gdpr-2016-679"],
    ] as const) {
      versionIds[name] = (await db.frameworkVersion.findUniqueOrThrow({ where: { key } })).id;
    }
  });
  afterAll(() => h.stop());

  const choose = (...ids: string[]) =>
    h.put("/api/v1/organisation/frameworks", { frameworkVersionIds: ids });
  const chosen = async (...ids: string[]) => {
    const res = await choose(...ids);
    expect(res.status).toBe(200);
    return (res.body as FrameworksResponse).frameworks;
  };
  const setAppetite = (appetiteThreshold: unknown) =>
    h.put("/api/v1/organisation/risk-scale", { appetiteThreshold });

  it("confirms the chosen frameworks as manual, attributed and dated", async () => {
    const before = Date.now();
    const frameworks = await chosen(versionIds.iso, versionIds.gdpr);
    expect(frameworks.map((f) => f.frameworkVersionKey)).toEqual([
      "gdpr-2016-679",
      "iso27001-2022",
    ]);
    const iso = frameworks.find((f) => f.frameworkVersionId === versionIds.iso);
    expect(iso).toMatchObject({
      name: "ISO/IEC 27001",
      versionLabel: "2022",
      status: "confirmed",
      source: "manual",
      reasoning: null,
      confirmedBy: { id: h.userIds.admin, displayName: "Anna Admin" },
    });
    expect(Date.parse(iso?.confirmedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);

    // Choosing them again keeps the first confirmation and is not audited again.
    expect(await chosen(versionIds.gdpr, versionIds.iso)).toEqual(frameworks);
    const rows = await audits("organisation.framework_confirmed");
    expect(
      rows.map((r) => [
        r.objectType,
        (r.afterRef as { frameworkVersionKey: string }).frameworkVersionKey,
      ]),
    ).toEqual([
      ["OrganisationFramework", "iso27001-2022"],
      ["OrganisationFramework", "gdpr-2016-679"],
    ]);
    const org = (await h.get("/api/v1/organisation", "rita")).body as OrganisationResponse;
    expect(org.frameworks).toEqual(frameworks);
  });

  it("deselecting removes a confirmed framework and audits it", async () => {
    const [gdpr] = await chosen(versionIds.iso, versionIds.gdpr);
    const after = await chosen(versionIds.iso);
    expect(after.map((f) => f.frameworkVersionKey)).toEqual(["iso27001-2022"]);
    expect(await db.organisationFramework.count()).toBe(1);
    const removed = await audits("organisation.framework_removed");
    expect(removed.map((r) => [r.objectType, r.objectId, r.beforeRef])).toEqual([
      [
        "OrganisationFramework",
        gdpr?.id,
        {
          frameworkVersionKey: "gdpr-2016-679",
          status: "confirmed",
          source: "manual",
        },
      ],
    ]);
  });

  it("dismisses a suggested framework that was not chosen; a chosen one keeps source ai and reasoning", async () => {
    const make = (frameworkVersionId: string) =>
      db.organisationFramework.create({
        data: {
          frameworkVersionId,
          status: "suggested",
          source: "ai",
          reasoning: "r",
        },
      });
    const suggested = await make(versionIds.gdpr);
    const frameworks = await chosen(versionIds.iso);
    expect(frameworks.map((f) => [f.frameworkVersionKey, f.status, f.source])).toEqual([
      ["iso27001-2022", "confirmed", "manual"],
    ]);
    expect(await db.organisationFramework.count({ where: { id: suggested.id } })).toBe(0);
    expect(await audits("organisation.framework_removed")).toEqual([]);
    const dismissed = await audits("organisation.framework_suggestion_dismissed");
    expect(dismissed.map((r) => [r.objectId, r.beforeRef])).toEqual([
      [
        suggested.id,
        {
          frameworkVersionKey: "gdpr-2016-679",
          status: "suggested",
          source: "ai",
        },
      ],
    ]);

    // Choosing a suggested framework confirms it and keeps its source and reasoning (P3-R16).
    const again = await make(versionIds.gdpr);
    const both = await chosen(versionIds.iso, versionIds.gdpr);
    expect(both.find((f) => f.id === again.id)).toMatchObject({
      status: "confirmed",
      source: "ai",
      reasoning: "r",
      confirmedBy: { id: h.userIds.admin },
    });
  });

  it("rejects an unknown framework version", async () => {
    const unknown = "0190a5c4-0000-7000-8000-000000000001";
    const res = await choose(versionIds.iso, unknown);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["frameworkVersionIds.1"]);
    expect(await db.organisationFramework.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("sets the appetite as a new immutable scale version with the default labels", async () => {
    const first = await setAppetite(4);
    expect(first.status).toBe(200);
    const v1 = first.body as RiskScaleDto;
    expect(v1.version).toBe(1);
    expect(v1.appetiteThreshold).toBe(4);
    expect(v1.likelihood.map((l) => l.label)).toEqual([
      "Rare",
      "Unlikely",
      "Possible",
      "Likely",
      "Almost certain",
    ]);
    expect(v1.impact.map((l) => l.label)).toEqual([
      "Negligible",
      "Minor",
      "Moderate",
      "Major",
      "Severe",
    ]);
    expect(v1.likelihood[3]?.description).toBe("Will probably happen this year.");

    const v2 = (await setAppetite(14)).body as RiskScaleDto;
    expect(v2.version).toBe(2);
    const same = await setAppetite(14);
    expect(same.status).toBe(200);
    expect(same.body).toEqual(v2);

    expect(await db.riskScale.count()).toBe(2);
    expect(await db.riskScaleLevel.count()).toBe(20);
    const rows = await audits("organisation.risk_scale_created");
    expect(rows.map((r) => [r.objectType, r.afterRef])).toEqual([
      ["RiskScale", { version: 1, appetiteThreshold: 4 }],
      ["RiskScale", { version: 2, appetiteThreshold: 14 }],
    ]);
    const org = (await h.get("/api/v1/organisation")).body as OrganisationResponse;
    expect(org.riskScale).toEqual(v2);
    expect(org.defaultRiskScale.appetiteThreshold).toBe(9);
  });

  it("rejects an appetite outside 1–24", async () => {
    for (const value of [0, 25, 9.5, "9"]) {
      const res = await setAppetite(value);
      expect(res.status, String(value)).toBe(400);
      expect(detailPaths(res)).toEqual(["appetiteThreshold"]);
    }
    expect(await db.riskScale.count()).toBe(0);
  });
});
