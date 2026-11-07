import type { UnitsResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths, organisationHarness, raceUnderSetupLock } from "./harness.js";

type SiteBody = { id?: string; name: string; countryCode: string };
type DepartmentBody = { id?: string; name: string };

describe("organisation sites and departments", () => {
  const h = organisationHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const save = (sites: SiteBody[], departments: DepartmentBody[] = []) =>
    h.put("/api/v1/organisation/units", { sites, departments });
  const saved = async (sites: SiteBody[], departments: DepartmentBody[] = []) => {
    const res = await save(sites, departments);
    expect(res.status).toBe(200);
    return res.body as UnitsResponse;
  };
  const storedSites = () =>
    db.site.findMany({
      orderBy: { name: "asc" },
      select: { name: true, nameKey: true, countryCode: true },
    });
  const useSite = (siteId: string) =>
    db.roleAssignment.create({
      data: {
        userId: h.userIds.rita,
        role: "risk_owner",
        scopeType: "SITE",
        siteId,
        grantedById: h.userIds.admin,
      },
    });

  it("replaces the site list: creates, renames and removes, with one audit row per change", async () => {
    const first = await saved([
      { name: "Riga", countryCode: "LV" },
      { name: "Berlin", countryCode: "DE" },
      { name: "Warsaw", countryCode: "PL" },
    ]);
    // Sorted by name, ignoring case.
    expect(first.sites.map((s) => s.name)).toEqual(["Berlin", "Riga", "Warsaw"]);
    const [berlin, riga, warsaw] = first.sites;
    if (!riga || !berlin || !warsaw) throw new Error("sites missing");

    const second = await saved([
      { id: riga.id, name: "Riga HQ", countryCode: "LV" },
      { id: berlin.id, name: "Berlin", countryCode: "DE" },
      { name: "Vilnius", countryCode: "LT" },
    ]);
    expect(second.sites).toEqual([
      { id: berlin.id, name: "Berlin", countryCode: "DE" },
      { id: riga.id, name: "Riga HQ", countryCode: "LV" },
      { id: expect.any(String) as string, name: "Vilnius", countryCode: "LT" },
    ]);
    expect(await storedSites()).toEqual([
      { name: "Berlin", nameKey: "berlin", countryCode: "DE" },
      { name: "Riga HQ", nameKey: "riga hq", countryCode: "LV" },
      { name: "Vilnius", nameKey: "vilnius", countryCode: "LT" },
    ]);

    expect((await audits("organisation.site_added")).map((r) => r.afterRef)).toEqual([
      { name: "Riga", countryCode: "LV" },
      { name: "Berlin", countryCode: "DE" },
      { name: "Warsaw", countryCode: "PL" },
      { name: "Vilnius", countryCode: "LT" },
    ]);
    const updated = await audits("organisation.site_updated");
    expect(updated.map((r) => [r.objectId, r.beforeRef, r.afterRef])).toEqual([
      [riga.id, { name: "Riga", countryCode: "LV" }, { name: "Riga HQ", countryCode: "LV" }],
    ]);
    const removed = await audits("organisation.site_removed");
    expect(removed.map((r) => [r.objectType, r.objectId, r.beforeRef])).toEqual([
      ["Site", warsaw.id, { name: "Warsaw", countryCode: "PL" }],
    ]);
  });

  it("swaps two site names in one save", async () => {
    const [a, b] = (
      await saved([
        { name: "North", countryCode: "LV" },
        { name: "South", countryCode: "LV" },
      ])
    ).sites;
    if (!a || !b) throw new Error("sites missing");
    const swapped = await saved([
      { id: a.id, name: "South", countryCode: "LV" },
      { id: b.id, name: "north", countryCode: "LV" },
    ]);
    expect(swapped.sites.map((s) => [s.id, s.name])).toEqual([
      [b.id, "north"],
      [a.id, "South"],
    ]);
  });

  it("rejects duplicate site names ignoring case and spaces", async () => {
    const res = await save([
      { name: " Riga ", countryCode: "LV" },
      { name: "riga", countryCode: "LV" },
    ]);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["sites.1.name"]);
    expect(await db.site.count()).toBe(0);
  });

  it("refuses a name with a tab or other non-space whitespace with 400, not 500", async () => {
    const res = await save([{ name: "Riga\t", countryCode: "LV" }], [{ name: "IT " }]);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["sites.0.name", "departments.0.name"]);
    expect(await db.site.count()).toBe(0);
  });

  it("refuses NUL and invisible format characters in unit names with 400, not 500", async () => {
    const res = await save(
      [
        { name: "Riga\u0000", countryCode: "LV" },
        { name: "Riga\u200b", countryCode: "LV" },
      ],
      [{ name: "\u0000IT" }],
    );
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["sites.0.name", "sites.1.name", "departments.0.name"]);
    expect(await db.site.count()).toBe(0);
  });

  it("refuses to remove a site an asset uses", async () => {
    const [riga, berlin] = (
      await saved([
        { name: "Riga", countryCode: "LV" },
        { name: "Berlin", countryCode: "DE" },
      ])
    ).sites;
    if (!riga || !berlin) throw new Error("sites missing");
    await db.asset.create({
      data: { name: "Server room", nameKey: "server room", type: "facility", siteId: riga.id },
    });
    const res = await save([{ id: berlin.id, name: "Berlin", countryCode: "DE" }]);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual([`siteInUse.${riga.id}`]);
    expect(await db.site.count()).toBe(2);
  });

  it("stores the name key exactly as the database derives it", async () => {
    await saved([{ name: "  MÜNCHEN Süd  ", countryCode: "DE" }], [{ name: "Ärzte" }]);
    const [site] = await db.$queryRaw<{ ok: boolean }[]>`
      SELECT bool_and("nameKey" = lower(btrim("name"))) AS ok FROM "Site"`;
    expect(site?.ok).toBe(true);
    expect((await db.site.findFirstOrThrow()).name).toBe("MÜNCHEN Süd");
  });

  it("rejects an unknown country code", async () => {
    const res = await save([{ name: "Atlantis", countryCode: "XX" }]);
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["sites.0.countryCode"]);
  });

  it("rejects an id that is not a stored unit, or the same id twice", async () => {
    const [riga] = (await saved([{ name: "Riga", countryCode: "LV" }])).sites;
    if (!riga) throw new Error("site missing");
    const unknown = "0190a5c4-0000-7000-8000-000000000001";
    const res = await save(
      [
        { id: riga.id, name: "Riga", countryCode: "LV" },
        { id: unknown, name: "Tallinn", countryCode: "EE" },
        { id: riga.id, name: "Riga 2", countryCode: "LV" },
      ],
      [{ id: unknown, name: "IT" }],
    );
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["sites.1.id", "sites.2.id", "departments.0.id"]);
    expect(await storedSites()).toEqual([{ name: "Riga", nameKey: "riga", countryCode: "LV" }]);
  });

  it("refuses to remove a site a role assignment uses, and changes nothing", async () => {
    const [riga, berlin] = (
      await saved(
        [
          { name: "Riga", countryCode: "LV" },
          { name: "Berlin", countryCode: "DE" },
        ],
        [{ name: "Finance" }],
      )
    ).sites;
    if (!riga || !berlin) throw new Error("sites missing");
    await useSite(berlin.id);
    const before = await db.auditEvent.count();

    const res = await save([{ id: riga.id, name: "Riga HQ", countryCode: "LV" }], [{ name: "IT" }]);
    expect(res.status).toBe(409);
    expect(detailPaths(res)[0]).toBe(`siteInUse.${berlin.id}`);
    expect((await storedSites()).map((s) => s.name)).toEqual(["Berlin", "Riga"]);
    expect((await db.department.findMany()).map((d) => d.name)).toEqual(["Finance"]);
    expect(await db.auditEvent.count()).toBe(before);
  });

  it("two concurrent site saves leave one consistent list", async () => {
    const results = await raceUnderSetupLock(() => [
      save([
        { name: "Riga", countryCode: "LV" },
        { name: "Berlin", countryCode: "DE" },
      ]),
      save([
        { name: "riga", countryCode: "LV" },
        { name: "Warsaw", countryCode: "PL" },
      ]),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const names = (await storedSites()).map((s) => s.nameKey);
    expect(new Set(names).size).toBe(names.length);
    expect([
      ["berlin", "riga"],
      ["riga", "warsaw"],
    ]).toContainEqual(names);
  });

  it("replaces departments, and refuses to remove one in use", async () => {
    const sites = [{ name: "Riga", countryCode: "LV" }];
    const first = await saved(sites, [{ name: "Finance" }, { name: "IT" }]);
    const [riga] = first.sites;
    const [finance, it] = first.departments;
    if (!riga || !finance || !it) throw new Error("units missing");
    expect(first.departments.map((d) => d.name)).toEqual(["Finance", "IT"]);

    const second = await saved(
      [{ id: riga.id, name: "Riga", countryCode: "LV" }],
      [{ id: finance.id, name: "Finance & Risk" }, { name: "HR" }],
    );
    expect(second.departments.map((d) => d.name)).toEqual(["Finance & Risk", "HR"]);
    expect((await audits("organisation.department_removed")).map((r) => r.objectId)).toEqual([
      it.id,
    ]);
    expect((await audits("organisation.department_updated")).map((r) => r.afterRef)).toEqual([
      { name: "Finance & Risk" },
    ]);
    expect(await audits("organisation.department_added")).toHaveLength(3);

    await db.roleAssignment.create({
      data: {
        userId: h.userIds.rita,
        role: "risk_owner",
        scopeType: "DEPARTMENT",
        departmentId: finance.id,
        grantedById: h.userIds.admin,
      },
    });
    const before = await db.auditEvent.count();
    // The site rename and the department removal are one save: neither is applied.
    const res = await save([{ id: riga.id, name: "Riga HQ", countryCode: "LV" }], []);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual([`departmentInUse.${finance.id}`]);
    expect((await storedSites()).map((s) => s.name)).toEqual(["Riga"]);
    expect(await db.department.count()).toBe(2);
    expect(await db.auditEvent.count()).toBe(before);
  });
});
