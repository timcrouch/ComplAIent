/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture indexes are known to exist */
import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncControlLibrary } from "../src/sync.js";
import { FIXTURE_LIBRARY } from "../src/testing.js";
import type { LibraryContent } from "../src/schema.js";
import { CONTROL_CATEGORIES } from "@isms/domain";

const env = loadConfig(databaseTestConfig);
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const fresh = (): LibraryContent => structuredClone(FIXTURE_LIBRARY);

/** A two-level framework (Function, then Category), unmapped: sync does not need mappings. */
const twoLevel = (): LibraryContent["frameworks"][number] => ({
  framework: { key: "csf", name: "CSF", publisher: "P", summary: "S" },
  version: { key: "csf-2", label: "2" },
  groups: [
    { key: "GV", title: "Govern" },
    { key: "GV.OC", title: "Organisational context", parent: "GV" },
    { key: "ID", title: "Identify" },
    { key: "ID.AM", title: "Asset management", parent: "ID" },
    { key: "ID.RA", title: "Risk assessment", parent: "ID" },
  ],
  requirements: [
    { ref: "GV.OC-01", title: "t", group: "GV.OC" },
    { ref: "ID.AM-01", title: "t", group: "ID.AM" },
    { ref: "ID.RA-01", title: "t", group: "ID.RA" },
  ],
});

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("syncControlLibrary", () => {
  it("creates frameworks, requirements, controls and unreviewed mappings", async () => {
    const summary = await syncControlLibrary(db, fresh());
    expect(summary).toEqual({
      libraryVersion: "2026.11.0-test",
      frameworks: 2,
      requirements: 3,
      requirementsByVersion: { "iso27001-2022": 2, "gdpr-2016-679": 1 },
      groups: 2,
      controls: 3,
      mappingsCreated: 4,
      orphanedMappings: 0,
    });
    expect(await db.framework.count()).toBe(2);
    expect(await db.requirement.count()).toBe(3);
    expect(await db.control.count()).toBe(3);
    const mappings = await db.controlRequirementMapping.findMany();
    expect(mappings).toHaveLength(4);
    expect(mappings.every((m) => m.reviewedAt === null && m.reviewedById === null)).toBe(true);
  });

  it("is idempotent", async () => {
    await syncControlLibrary(db, fresh());
    const second = await syncControlLibrary(db, fresh());
    expect(second.mappingsCreated).toBe(0);
    expect(await db.requirement.count()).toBe(3);
    expect(await db.controlRequirementMapping.count()).toBe(4);
  });

  it("keeps a mapping's review and a requirement's fullText when synced again", async () => {
    await syncControlLibrary(db, fresh());
    const user = await db.user.create({
      data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
    });
    const mapping = (await db.controlRequirementMapping.findFirst())!;
    const reviewedAt = new Date("2026-11-04T10:00:00Z");
    await db.controlRequirementMapping.update({
      where: { id: mapping.id },
      data: { reviewedById: user.id, reviewedAt },
    });
    await db.requirement.updateMany({
      where: { ref: "A.5.1" },
      data: { fullText: "licensed text" },
    });

    await syncControlLibrary(db, fresh());

    const after = await db.controlRequirementMapping.findUniqueOrThrow({
      where: { id: mapping.id },
    });
    expect(after.reviewedById).toBe(user.id);
    expect(after.reviewedAt).toEqual(reviewedAt);
    expect((await db.requirement.findFirstOrThrow({ where: { ref: "A.5.1" } })).fullText).toBe(
      "licensed text",
    );
  });

  it("updates control and requirement text and order from the content", async () => {
    await syncControlLibrary(db, fresh());
    const lib = fresh();
    lib.controls.find((c) => c.code === "RES-01")!.title = "Back up and restore";
    lib.frameworks[0]!.requirements.reverse();
    await syncControlLibrary(db, lib);
    expect((await db.control.findUniqueOrThrow({ where: { code: "RES-01" } })).title).toBe(
      "Back up and restore",
    );
    const a513 = await db.requirement.findFirstOrThrow({ where: { ref: "A.8.13" } });
    expect(a513.sortOrder).toBe(0);
  });

  it("never deletes; reports mappings missing from the content", async () => {
    await syncControlLibrary(db, fresh());
    const lib = fresh();
    lib.controls.find((c) => c.code === "ACC-01")!.mappings = [
      { framework: "iso27001-2022", ref: "A.5.1" },
    ];
    const summary = await syncControlLibrary(db, lib);
    expect(summary.orphanedMappings).toBe(1);
    expect(summary.mappingsCreated).toBe(1);
    expect(await db.controlRequirementMapping.count()).toBe(5);
  });

  it("links each requirement to its group; flat frameworks have none", async () => {
    await syncControlLibrary(db, fresh());
    const rows = await db.requirement.findMany({
      include: { group: true },
      orderBy: { ref: "asc" },
    });
    expect(rows.map((r) => [r.ref, r.group?.key ?? null])).toEqual([
      ["A.5.1", "A.5"],
      ["A.8.13", "A.8"],
      ["Art. 32", null],
    ]);
    const groups = await db.requirementGroup.findMany({ orderBy: { sortOrder: "asc" } });
    expect(groups.map((g) => [g.key, g.title, g.parentId, g.sortOrder])).toEqual([
      ["A.5", "Organisational controls", null, 0],
      ["A.8", "Technological controls", null, 1],
    ]);
  });

  it("creates two-level groups, parents first", async () => {
    const lib = fresh();
    lib.frameworks.push(twoLevel());
    const summary = await syncControlLibrary(db, lib);
    // A total across the library: the fixture's own groups plus the five added here.
    const groupCount = lib.frameworks.reduce((n, f) => n + (f.groups?.length ?? 0), 0);
    expect(groupCount).toBe(7);
    expect(summary.groups).toBe(groupCount);
    const groups = await db.requirementGroup.findMany({
      where: { frameworkVersion: { key: "csf-2" } },
      include: { parent: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(groups.map((g) => [g.key, g.parent?.key ?? null, g.sortOrder])).toEqual([
      ["GV", null, 0],
      ["GV.OC", "GV", 1],
      ["ID", null, 2],
      ["ID.AM", "ID", 3],
      ["ID.RA", "ID", 4],
    ]);
    const am = await db.requirement.findFirstOrThrow({
      where: { ref: "ID.AM-01" },
      include: { group: true },
    });
    expect(am.group?.key).toBe("ID.AM");
  });

  it("updates group titles, order and membership, and never deletes a group", async () => {
    const lib = fresh();
    lib.frameworks.push(twoLevel());
    await syncControlLibrary(db, lib);

    const next = fresh();
    const csf = twoLevel();
    csf.groups = [
      { key: "GV", title: "Govern (renamed)" },
      { key: "GV.OC", title: "Organisational context", parent: "GV" },
      { key: "ID", title: "Identify" },
      { key: "ID.AM", title: "Asset management", parent: "ID" },
    ];
    csf.requirements[2]!.group = "ID.AM";
    next.frameworks.push(csf);
    await syncControlLibrary(db, next);

    const gv = await db.requirementGroup.findFirstOrThrow({ where: { key: "GV" } });
    expect(gv.title).toBe("Govern (renamed)");
    const ra = await db.requirement.findFirstOrThrow({
      where: { ref: "ID.RA-01" },
      include: { group: true },
    });
    expect(ra.group?.key).toBe("ID.AM");
    // ID.RA is no longer in the content but stays in the database.
    expect(await db.requirementGroup.count({ where: { key: "ID.RA" } })).toBe(1);
  });

  it("re-parents groups: a child moves under another parent, or becomes top-level", async () => {
    const lib = fresh();
    lib.frameworks.push(twoLevel());
    await syncControlLibrary(db, lib);

    const next = fresh();
    const csf = twoLevel();
    // GV.OC moves from GV to ID; ID.RA becomes a top-level group of its own.
    csf.groups = [
      { key: "GV", title: "Govern" },
      { key: "GV.X", title: "Keeps GV a parent", parent: "GV" },
      { key: "ID", title: "Identify" },
      { key: "GV.OC", title: "Organisational context", parent: "ID" },
      { key: "ID.AM", title: "Asset management", parent: "ID" },
      { key: "ID.RA", title: "Risk assessment" },
    ];
    csf.requirements = [
      { ref: "GV.X-01", title: "t", group: "GV.X" },
      { ref: "GV.OC-01", title: "t", group: "GV.OC" },
      { ref: "ID.AM-01", title: "t", group: "ID.AM" },
      { ref: "ID.RA-01", title: "t", group: "ID.RA" },
    ];
    next.frameworks.push(csf);
    await syncControlLibrary(db, next);

    const groups = await db.requirementGroup.findMany({
      where: { frameworkVersion: { key: "csf-2" } },
      include: { parent: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(groups.map((g) => [g.key, g.parent?.key ?? null])).toEqual([
      ["GV", null],
      ["GV.X", "GV"],
      ["ID", null],
      ["GV.OC", "ID"],
      ["ID.AM", "ID"],
      ["ID.RA", null],
    ]);
    const oc = await db.requirement.findFirstOrThrow({
      where: { ref: "GV.OC-01" },
      include: { group: { include: { parent: true } } },
    });
    expect(oc.group?.parent?.key).toBe("ID");
  });

  it("matches the Prisma ControlCategory enum to CONTROL_CATEGORIES", async () => {
    const rows = await db.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ControlCategory' ORDER BY e.enumsortorder`;
    expect(rows.map((r) => r.v)).toEqual([...CONTROL_CATEGORIES]);
  });
});
