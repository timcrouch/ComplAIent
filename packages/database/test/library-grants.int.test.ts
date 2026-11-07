import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

async function seed() {
  const fw = await owner.framework.create({
    data: { key: "f", name: "F", publisher: "P", summary: "S" },
  });
  const version = await owner.frameworkVersion.create({
    data: { frameworkId: fw.id, key: "f-1", label: "1" },
  });
  const group = await owner.requirementGroup.create({
    data: { frameworkVersionId: version.id, key: "G", title: "Group", sortOrder: 0 },
  });
  const requirement = await owner.requirement.create({
    data: {
      frameworkVersionId: version.id,
      ref: "R1",
      title: "T",
      sortOrder: 0,
      groupId: group.id,
    },
  });
  const control = await owner.control.create({
    data: {
      code: "GOV-01",
      title: "T",
      description: "D",
      guidance: ["g"],
      category: "governance",
      libraryVersion: "2026.11.0",
    },
  });
  const mapping = await owner.controlRequirementMapping.create({
    data: { controlId: control.id, requirementId: requirement.id },
  });
  const user = await owner.user.create({
    data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
  });
  return { control, group, mapping, requirement, user, version };
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("library table privileges", () => {
  it("the app role reads the library but cannot change content", async () => {
    const { control } = await seed();
    expect(await app.control.count()).toBe(1);
    expect(await app.requirement.count()).toBe(1);
    await expect(
      app.$executeRaw`UPDATE "Control" SET title = 'x' WHERE id = ${control.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRaw`DELETE FROM "Control" WHERE id = ${control.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`TRUNCATE "Requirement" CASCADE`).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.$executeRaw`INSERT INTO "Framework" (id, key, name, publisher, summary) VALUES (gen_random_uuid(), 'k', 'n', 'p', 's')`,
    ).rejects.toThrow(/permission denied/);
  });

  it("the app role reads requirement groups but cannot change them", async () => {
    const { group, version } = await seed();
    const read = await app.requirement.findFirstOrThrow({ include: { group: true } });
    expect(read.group?.key).toBe("G");
    await expect(
      app.$executeRaw`UPDATE "RequirementGroup" SET title = 'x' WHERE id = ${group.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRaw`DELETE FROM "RequirementGroup" WHERE id = ${group.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`TRUNCATE "RequirementGroup" CASCADE`).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.$executeRaw`INSERT INTO "RequirementGroup" (id, "frameworkVersionId", key, title, "sortOrder") VALUES (gen_random_uuid(), ${version.id}::uuid, 'k', 't', 1)`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`UPDATE "Requirement" SET "groupId" = NULL`).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a group key is unique per framework version", async () => {
    const { version } = await seed();
    await expect(
      owner.requirementGroup.create({
        data: { frameworkVersionId: version.id, key: "G", title: "Again", sortOrder: 1 },
      }),
    ).rejects.toThrow();
  });

  it("the app role can record a review and nothing else on a mapping", async () => {
    const { mapping, user } = await seed();
    await app.$executeRaw`UPDATE "ControlRequirementMapping" SET "reviewedById" = ${user.id}::uuid, "reviewedAt" = now() WHERE id = ${mapping.id}::uuid`;
    const row = await owner.controlRequirementMapping.findUniqueOrThrow({
      where: { id: mapping.id },
    });
    expect(row.reviewedById).toBe(user.id);
    await expect(
      app.$executeRaw`UPDATE "ControlRequirementMapping" SET "createdAt" = now() WHERE id = ${mapping.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRaw`DELETE FROM "ControlRequirementMapping" WHERE id = ${mapping.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
  });

  it("a review needs both reviewer and date", async () => {
    const { mapping, user } = await seed();
    await expect(
      owner.$executeRaw`UPDATE "ControlRequirementMapping" SET "reviewedAt" = now() WHERE id = ${mapping.id}::uuid`,
    ).rejects.toThrow(/check constraint/);
    await expect(
      owner.$executeRaw`UPDATE "ControlRequirementMapping" SET "reviewedById" = ${user.id}::uuid WHERE id = ${mapping.id}::uuid`,
    ).rejects.toThrow(/check constraint/);
  });
});
