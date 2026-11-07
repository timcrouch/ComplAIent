import type { CompleteSetupResponse, OrganisationResponse } from "@isms/contracts";
import { syncControlLibrary } from "@isms/control-library";
import { FIXTURE_LIBRARY } from "@isms/control-library/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths, organisationHarness, raceUnderSetupLock } from "./harness.js";

const PROFILE = {
  name: "Northwind Bank",
  description: "A regional bank.",
  approximateHeadcount: 250,
};

describe("organisation profile and setup completion", () => {
  const h = organisationHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const organisation = async (who: "admin" | "rita" = "admin") => {
    const res = await h.get("/api/v1/organisation", who);
    expect(res.status).toBe(200);
    return res.body as OrganisationResponse;
  };

  /** Every step done: profile, one site, one confirmed framework and a risk scale. */
  const completeEverySetupStep = async () => {
    await syncControlLibrary(db, FIXTURE_LIBRARY);
    const version = await db.frameworkVersion.findFirstOrThrow({ select: { id: true } });
    expect((await h.put("/api/v1/organisation/profile", PROFILE)).status).toBe(200);
    const units = { sites: [{ name: "Riga", countryCode: "LV" }], departments: [] };
    expect((await h.put("/api/v1/organisation/units", units)).status).toBe(200);
    const frameworks = { frameworkVersionIds: [version.id] };
    expect((await h.put("/api/v1/organisation/frameworks", frameworks)).status).toBe(200);
    const scale = { appetiteThreshold: 9 };
    expect((await h.put("/api/v1/organisation/risk-scale", scale)).status).toBe(200);
  };

  it("a new installation reports every setup step missing and offers the default scale", async () => {
    const body = await organisation();
    expect(body.profile).toBeNull();
    expect(body.sites).toEqual([]);
    expect(body.departments).toEqual([]);
    expect(body.frameworks).toEqual([]);
    expect(body.riskScale).toBeNull();
    expect(body.setup).toEqual({
      completedAt: null,
      missing: ["profile", "sites", "frameworks", "riskScale"],
    });
    expect(body.defaultRiskScale.version).toBeNull();
    expect(body.defaultRiskScale.appetiteThreshold).toBe(9);
    expect(body.defaultRiskScale.likelihood[0]?.label).toBe("Rare");
    expect(body.defaultRiskScale.likelihood.map((l) => l.value)).toEqual([1, 2, 3, 4, 5]);
    expect(body.defaultRiskScale.impact[4]).toEqual({
      value: 5,
      label: "Severe",
      description: "Threatens the organisation or causes lasting harm to people.",
    });
  });

  it("saves the profile and audits before and after", async () => {
    const first = await h.put("/api/v1/organisation/profile", {
      ...PROFILE,
      name: "  Northwind Bank  ",
    });
    expect(first.status).toBe(200);
    const body = first.body as OrganisationResponse;
    expect(body.profile).toEqual(PROFILE);
    expect(body.setup.missing).toEqual(["sites", "frameworks", "riskScale"]);

    const changed = { ...PROFILE, approximateHeadcount: 300 };
    expect((await h.put("/api/v1/organisation/profile", changed)).status).toBe(200);
    // Saving the same values again changes nothing and is not audited.
    expect((await h.put("/api/v1/organisation/profile", changed)).status).toBe(200);

    const org = await db.organisation.findFirstOrThrow();
    const rows = await audits("organisation.profile_updated");
    expect(rows.map((r) => [r.objectType, r.objectId, r.actorUserId])).toEqual([
      ["Organisation", org.id, h.userIds.admin],
      ["Organisation", org.id, h.userIds.admin],
    ]);
    expect(rows[0]?.beforeRef).toBeNull();
    expect(rows[0]?.afterRef).toEqual(PROFILE);
    expect(rows[1]?.beforeRef).toEqual(PROFILE);
    expect(rows[1]?.afterRef).toEqual(changed);
  });

  it("rejects an invalid profile", async () => {
    const res = await h.put("/api/v1/organisation/profile", {
      name: " ",
      description: "x",
      approximateHeadcount: 0,
      extra: true,
    });
    expect(res.status).toBe(400);
    expect(detailPaths(res).sort()).toEqual(["", "approximateHeadcount", "name"]);
    expect(await db.organisation.count()).toBe(0);
  });

  it("refuses NUL and other control characters in the profile with 400, not 500", async () => {
    const res = await h.put("/api/v1/organisation/profile", {
      ...PROFILE,
      name: "Northwind\u0000Bank",
      description: "A regional bank.\u0000",
    });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["name", "description"]);
    const tabbed = await h.put("/api/v1/organisation/profile", { ...PROFILE, name: "North\twind" });
    expect(detailPaths(tabbed)).toEqual(["name"]);
    expect(await db.organisation.count()).toBe(0);

    // The description may span several lines.
    const multiLine = { ...PROFILE, description: "A regional bank.\r\nFounded 1990." };
    const saved = await h.put("/api/v1/organisation/profile", multiLine);
    expect(saved.status).toBe(200);
    expect((saved.body as OrganisationResponse).profile?.description).toBe(multiLine.description);
  });

  it("a suggested framework alone does not complete the frameworks step", async () => {
    await completeEverySetupStep();
    await db.organisationFramework.updateMany({
      data: { status: "suggested", source: "ai", confirmedById: null, confirmedAt: null },
    });
    const res = await h.post("/api/v1/organisation/setup/complete");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["setupIncomplete.frameworks"]);
  });

  it("two concurrent profile saves leave exactly one organisation row", async () => {
    const results = await raceUnderSetupLock(() => [
      h.put("/api/v1/organisation/profile", PROFILE),
      h.put("/api/v1/organisation/profile", { ...PROFILE, name: "Southwind Bank" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.organisation.count()).toBe(1);
    const rows = await audits("organisation.profile_updated");
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.beforeRef === null)).toHaveLength(1);
  });

  it("completing setup lists what is missing", async () => {
    expect((await h.put("/api/v1/organisation/profile", PROFILE)).status).toBe(200);
    const res = await h.post("/api/v1/organisation/setup/complete");
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual([
      "setupIncomplete.sites",
      "setupIncomplete.frameworks",
      "setupIncomplete.riskScale",
    ]);
    expect((await db.organisation.findFirstOrThrow()).setupCompletedAt).toBeNull();
    expect(await audits("organisation.setup_completed")).toEqual([]);
  });

  it("completes setup once everything is in place; completing again changes nothing", async () => {
    await completeEverySetupStep();
    expect((await organisation()).setup.missing).toEqual([]);

    const first = await h.post("/api/v1/organisation/setup/complete");
    expect(first.status).toBe(200);
    const { completedAt } = first.body as CompleteSetupResponse;
    const again = await h.post("/api/v1/organisation/setup/complete");
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ completedAt });

    const org = await db.organisation.findFirstOrThrow();
    expect(org.setupCompletedAt?.toISOString()).toBe(completedAt);
    expect(org.setupCompletedById).toBe(h.userIds.admin);
    expect((await organisation("rita")).setup).toEqual({ completedAt, missing: [] });
    const rows = await audits("organisation.setup_completed");
    expect(rows.map((r) => [r.objectType, r.objectId, r.afterRef])).toEqual([
      ["Organisation", org.id, { setupCompletedAt: completedAt }],
    ]);
  });

  it("only administrators can change setup; everyone signed in can read it", async () => {
    expect((await h.get("/api/v1/organisation", "rita")).status).toBe(200);
    const writes = [
      await h.put("/api/v1/organisation/profile", PROFILE, "rita"),
      await h.put(
        "/api/v1/organisation/units",
        { sites: [{ name: "Riga", countryCode: "LV" }], departments: [] },
        "rita",
      ),
      await h.put("/api/v1/organisation/frameworks", { frameworkVersionIds: [] }, "rita"),
      await h.put("/api/v1/organisation/risk-scale", { appetiteThreshold: 9 }, "rita"),
      await h.post("/api/v1/organisation/setup/complete", "rita"),
    ];
    expect(writes.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await db.organisation.count()).toBe(0);
    expect(await db.site.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
  });
});

describe("organisation review interval", () => {
  const h = organisationHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const set = (months: unknown, who: "admin" | "rita" = "admin") =>
    h.put("/api/v1/organisation/review-interval", { months }, who);

  it("defaults to 12 months and an admin can change it, audited with before and after", async () => {
    await h.put("/api/v1/organisation/profile", PROFILE);
    expect(
      ((await h.get("/api/v1/organisation")).body as OrganisationResponse).reviewIntervalMonths,
    ).toBe(12);
    const res = await set(6);
    expect(res.status).toBe(200);
    expect((res.body as OrganisationResponse).reviewIntervalMonths).toBe(6);
    expect((await db.organisation.findFirstOrThrow()).reviewIntervalMonths).toBe(6);
    // Same value again: nothing changes and nothing is audited.
    expect((await set(6)).status).toBe(200);
    const rows = await audits("organisation.review_interval_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objectType: "Organisation",
      actorUserId: h.userIds.admin,
      beforeRef: { reviewIntervalMonths: 12 },
      afterRef: { reviewIntervalMonths: 6 },
    });
  });

  it("refuses other roles with 403", async () => {
    await h.put("/api/v1/organisation/profile", PROFILE);
    expect((await set(6, "rita")).status).toBe(403);
    expect((await db.organisation.findFirstOrThrow()).reviewIntervalMonths).toBe(12);
  });

  it("rejects out-of-range and non-integer months with 400", async () => {
    await h.put("/api/v1/organisation/profile", PROFILE);
    for (const months of [0, 37, 1.5, "6"]) {
      const res = await set(months);
      expect(res.status).toBe(400);
      expect(detailPaths(res)).toEqual(["months"]);
    }
    expect((await set(1)).status).toBe(200);
    expect((await set(36)).status).toBe(200);
  });

  it("is a conflict before the profile exists", async () => {
    const res = await set(6);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["setupIncomplete.profile"]);
  });
});
