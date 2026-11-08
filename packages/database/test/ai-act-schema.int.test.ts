import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const MUTABLE = ["OrganisationModule", "AiSystem", "AiSystemObligation", "AiSystemRisk"];

async function seedUser(): Promise<string> {
  const user = await owner.user.create({
    data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
  });
  return user.id;
}

/** Inserts a system as the app role (raw SQL, so the grants are what is tested). */
async function insertSystem(
  userId: string,
  overrides: { name?: string; nameKey?: string; intendedPurpose?: string } = {},
): Promise<string> {
  const name = overrides.name ?? "Scoring engine";
  const nameKey = overrides.nameKey ?? name.trim().toLowerCase();
  const purpose = overrides.intendedPurpose ?? "Scores loan applications";
  const rows = await app.$queryRaw<{ id: string }[]>`
    INSERT INTO "AiSystem" (id, name, "nameKey", "intendedPurpose", role, "usesGeneralPurposeModel", status, "ownerId", "createdById", "updatedAt")
    VALUES (gen_random_uuid(), ${name}, ${nameKey}, ${purpose}, 'deployer'::"AiActRole", false, 'in_use'::"AiSystemStatus", ${userId}::uuid, ${userId}::uuid, now())
    RETURNING id::text`;
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("AI Act privileges", () => {
  it.each(MUTABLE)("the app role may read and change %s but not truncate it", async (table) => {
    const rows = await app.$queryRawUnsafe<Record<string, boolean>[]>(
      `SELECT has_table_privilege('isms_app', '"${table}"', 'SELECT') AS sel,
              has_table_privilege('isms_app', '"${table}"', 'INSERT') AS ins,
              has_table_privilege('isms_app', '"${table}"', 'UPDATE') AS upd,
              has_table_privilege('isms_app', '"${table}"', 'DELETE') AS del,
              has_table_privilege('isms_app', '"${table}"', 'TRUNCATE') AS trunc`,
    );
    expect(rows[0]).toEqual({ sel: true, ins: true, upd: true, del: true, trunc: false });
  });

  it("the app role can switch a module on and off", async () => {
    const userId = await seedUser();
    await app.$executeRaw`
      INSERT INTO "OrganisationModule" (key, "enabledAt", "enabledById")
      VALUES ('eu_ai_act'::"ModuleKey", now(), ${userId}::uuid)`;
    await expect(
      app.$executeRaw`DELETE FROM "OrganisationModule" WHERE key = 'eu_ai_act'::"ModuleKey"`,
    ).resolves.toBe(1);
  });
});

describe("AI Act constraints", () => {
  it("keys names by lower(btrim(name)) and keeps them unique ignoring case", async () => {
    const userId = await seedUser();
    await insertSystem(userId, { name: "Scoring Engine", nameKey: "scoring engine" });
    await expect(
      insertSystem(userId, { name: "SCORING ENGINE", nameKey: "scoring engine" }),
    ).rejects.toThrow(/unique|duplicate|23505/i);
    await expect(insertSystem(userId, { name: "Chatbot", nameKey: "Chatbot" })).rejects.toThrow(
      /check constraint/,
    );
  });

  it("bounds the name and the intended purpose", async () => {
    const userId = await seedUser();
    await expect(insertSystem(userId, { name: "x".repeat(201) })).rejects.toThrow(
      /check constraint/,
    );
    await expect(insertSystem(userId, { intendedPurpose: "" })).rejects.toThrow(/check constraint/);
  });

  it("stores a classification only together with its time and author", async () => {
    const userId = await seedUser();
    const id = await insertSystem(userId);
    await expect(
      app.$executeRaw`UPDATE "AiSystem" SET "riskClass" = 'high_risk' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/check constraint/);
    await expect(
      app.$executeRaw`UPDATE "AiSystem" SET "riskClass" = 'high_risk', classification = '{}'::jsonb WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/check constraint/);
    await app.$executeRaw`
      UPDATE "AiSystem"
      SET "riskClass" = 'high_risk', classification = '{}'::jsonb, "classifiedAt" = now(), "classifiedById" = ${userId}::uuid
      WHERE id = ${id}::uuid`;
  });

  it("bounds obligation notes to 2000 characters and keys to the catalogue format", async () => {
    const userId = await seedUser();
    const id = await insertSystem(userId);
    const insert = (key: string, note: string) => app.$executeRaw`
      INSERT INTO "AiSystemObligation" ("aiSystemId", key, applicable, note, "updatedAt")
      VALUES (${id}::uuid, ${key}, true, ${note}, now())`;
    await expect(insert("ai_literacy", "x".repeat(2001))).rejects.toThrow(/check constraint/);
    await expect(insert("AI Literacy", "")).rejects.toThrow(/check constraint/);
    await insert("ai_literacy", "x".repeat(2000));
    await expect(insert("ai_literacy", "")).rejects.toThrow(/unique|duplicate|23505/i);
  });

  it("links a system to a risk once", async () => {
    const userId = await seedUser();
    const id = await insertSystem(userId);
    const risk = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO "Risk" (id, title, scenario, threat, consequence, "reporterId", "toConfirm", "aiAssisted", "updatedAt")
      VALUES (gen_random_uuid(), 't', 's', 'th', 'c', ${userId}::uuid, '{}', false, now())
      RETURNING id::text`;
    const link = () => app.$executeRaw`
      INSERT INTO "AiSystemRisk" ("aiSystemId", "riskId", "linkedById", "linkedAt")
      VALUES (${id}::uuid, ${risk[0]?.id}::uuid, ${userId}::uuid, now())`;
    await link();
    await expect(link()).rejects.toThrow(/unique|duplicate|23505/i);
  });
});
