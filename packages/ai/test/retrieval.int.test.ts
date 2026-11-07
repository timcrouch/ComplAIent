import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contentHash, controlEmbeddingText, type Embedder } from "../src/embedder.js";
import { ensureLibraryEmbedded, nearestControls } from "../src/retrieval.js";
import { createHashEmbedder } from "../src/testing.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const CONTROLS = [
  {
    code: "AST-03",
    title: "Encrypt laptops and removable media",
    description: "Laptops, phones and USB drives encrypt their storage.",
    guidance: ["Turn on full-disk encryption.", "Keep recovery keys safe."],
  },
  {
    code: "OPS-04",
    title: "Back up important data",
    description: "Backups are taken daily, kept apart and restored in tests.",
    guidance: ["Test a restore every quarter."],
  },
  {
    code: "PPL-02",
    title: "Train staff to spot phishing",
    description: "Everyone learns to recognise and report suspicious emails.",
    guidance: [],
  },
];

/** Counts the texts it was asked to embed. */
function counting(embedder: Embedder): Embedder & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: embedder.model,
    dimensions: embedder.dimensions,
    calls,
    embed(texts) {
      calls.push(...texts);
      return embedder.embed(texts);
    },
  };
}

async function seedControls(): Promise<void> {
  for (const c of CONTROLS) {
    await owner.control.create({
      data: { ...c, category: "operations", libraryVersion: "test" },
    });
  }
  const framework = await owner.framework.create({
    data: { key: "iso27001", name: "ISO 27001", publisher: "ISO", summary: "s" },
  });
  const version = await owner.frameworkVersion.create({
    data: { frameworkId: framework.id, key: "iso27001-2022", label: "2022" },
  });
  const requirement = await owner.requirement.create({
    data: { frameworkVersionId: version.id, ref: "A.8.1", title: "Endpoint devices", sortOrder: 1 },
  });
  const control = await owner.control.findUniqueOrThrow({ where: { code: "AST-03" } });
  await owner.controlRequirementMapping.create({
    data: { controlId: control.id, requirementId: requirement.id },
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  await seedControls();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("library embeddings", () => {
  it("embeds every control once and skips unchanged ones on a second run", async () => {
    const embedder = counting(createHashEmbedder());
    expect(await ensureLibraryEmbedded(app, embedder)).toEqual({ embedded: 3 });
    expect(embedder.calls).toHaveLength(3);
    const rows = await owner.controlEmbedding.findMany({ include: { control: true } });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.model).toBe("test/hash-384");
      expect(row.contentHash).toBe(contentHash(controlEmbeddingText(row.control)));
    }

    expect(await ensureLibraryEmbedded(app, embedder)).toEqual({ embedded: 0 });
    expect(embedder.calls).toHaveLength(3);
  });

  it("re-embeds a control whose text hash changed", async () => {
    await ensureLibraryEmbedded(app, createHashEmbedder());
    await owner.control.update({
      where: { code: "OPS-04" },
      data: { description: "Backups are encrypted and kept offline." },
    });
    const embedder = counting(createHashEmbedder());
    expect(await ensureLibraryEmbedded(app, embedder)).toEqual({ embedded: 1 });
    expect(embedder.calls).toEqual([
      expect.stringContaining("Backups are encrypted and kept offline."),
    ]);
  });

  it("re-embeds every control when the model changes", async () => {
    await ensureLibraryEmbedded(app, createHashEmbedder());
    const base = createHashEmbedder();
    const other: Embedder = { ...base, model: "test/other-384", embed: (t) => base.embed(t) };
    expect(await ensureLibraryEmbedded(app, other)).toEqual({ embedded: 3 });
    const models = await owner.controlEmbedding.findMany({ select: { model: true } });
    expect(models.every((m) => m.model === "test/other-384")).toBe(true);
  });
});

describe("nearest controls", () => {
  it("returns the nearest controls first", async () => {
    const embedder = createHashEmbedder();
    await ensureLibraryEmbedded(app, embedder);
    const target = CONTROLS[1];
    if (!target) throw new Error("fixture");
    const [query] = await embedder.embed([controlEmbeddingText(target)]);
    if (!query) throw new Error("no vector");

    const nearest = await nearestControls(app, query, 2);
    expect(nearest).toHaveLength(2);
    expect(nearest[0]).toMatchObject({ code: "OPS-04", title: "Back up important data", refs: [] });
  });

  it("carries the mapped requirement references", async () => {
    const embedder = createHashEmbedder();
    await ensureLibraryEmbedded(app, embedder);
    const [query] = await embedder.embed(["encrypt laptops removable media"]);
    if (!query) throw new Error("no vector");
    const [first] = await nearestControls(app, query, 15);
    expect(first).toMatchObject({ code: "AST-03", refs: ["iso27001-2022 A.8.1"] });
    expect(first?.controlId).toEqual(expect.any(String));
  });
});
