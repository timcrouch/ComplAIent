import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

type Privileges = { sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean };

async function tablePrivileges(table: string): Promise<Privileges | undefined> {
  const rows = await app.$queryRawUnsafe<Privileges[]>(
    `SELECT has_table_privilege('isms_app', '"${table}"', 'SELECT') AS sel,
            has_table_privilege('isms_app', '"${table}"', 'INSERT') AS ins,
            has_table_privilege('isms_app', '"${table}"', 'UPDATE') AS upd,
            has_table_privilege('isms_app', '"${table}"', 'DELETE') AS del,
            has_table_privilege('isms_app', '"${table}"', 'TRUNCATE') AS trunc`,
  );
  return rows[0];
}

async function columnUpdatable(column: string): Promise<boolean> {
  const rows = await app.$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT has_column_privilege('isms_app', '"AiInteraction"', '${column}', 'UPDATE') AS ok`,
  );
  return rows[0]?.ok ?? false;
}

async function seedUser(): Promise<string> {
  const user = await owner.user.create({
    data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
  });
  return user.id;
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("AI interaction privileges", () => {
  it("the app role may read and insert interactions but not update, delete or truncate them", async () => {
    expect(await tablePrivileges("AiInteraction")).toEqual({
      sel: true,
      ins: true,
      upd: false,
      del: false,
      trunc: false,
    });
  });

  it("the app role may update only outcome and discardedCount", async () => {
    expect(await columnUpdatable("outcome")).toBe(true);
    expect(await columnUpdatable("discardedCount")).toBe(true);
    for (const column of ["response", "request", "status", "model", "purpose", "actorUserId"]) {
      expect(await columnUpdatable(column)).toBe(false);
    }
  });

  it("the app role keeps full DML on AiSettings and ControlEmbedding", async () => {
    for (const table of ["AiSettings", "ControlEmbedding"]) {
      expect(await tablePrivileges(table)).toMatchObject({ sel: true, ins: true, upd: true });
    }
  });
});

describe("AI settings constraints", () => {
  it("allows exactly one settings row", async () => {
    await owner.aiSettings.create({ data: {} });
    await expect(owner.aiSettings.create({ data: {} })).rejects.toThrow();
    await expect(
      owner.$executeRaw`INSERT INTO "AiSettings" (id, singleton, "updatedAt") VALUES (gen_random_uuid(), false, now())`,
    ).rejects.toThrow(/check constraint/);
  });

  it("requires the key columns to be all set or all NULL", async () => {
    const userId = await seedUser();
    await expect(
      owner.aiSettings.create({ data: { sealedKey: new Uint8Array([1, 2, 3]), keyLast4: "WXYZ" } }),
    ).rejects.toThrow(/check constraint/);
    await expect(
      owner.aiSettings.create({
        data: {
          sealedKey: new Uint8Array([1, 2, 3]),
          keyLast4: "WXYZ",
          keySetById: userId,
          keySetAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ keyLast4: "WXYZ" });
  });
});
