import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const APPEND_ONLY = ["RiskVersion", "Evidence", "EvidenceControl", "Approval", "ConcernMessage"];
const SHA = "a".repeat(64);

async function seedUser(): Promise<string> {
  const user = await owner.user.create({
    data: {
      idpIssuer: "i",
      idpSubject: "s",
      email: "a@example.test",
      displayName: "A",
    },
  });
  return user.id;
}

/** Inserts a risk as the given client (raw SQL, so the test does not depend on generated models). */
async function insertRisk(
  db: typeof owner,
  reporterId: string,
  extra: { likelihood?: number } = {},
): Promise<string> {
  const likelihood = extra.likelihood ?? null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "Risk" (id, title, scenario, threat, consequence, "reporterId", likelihood, "toConfirm", "aiAssisted", "updatedAt")
    VALUES (gen_random_uuid(), 't', 's', 'th', 'c', ${reporterId}::uuid, ${likelihood}::int, '{}', false, now())
    RETURNING id::text`;
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

async function insertApproval(
  riskId: string,
  approverId: string,
  decision: "approved" | "returned",
): Promise<void> {
  await app.$executeRaw`
    INSERT INTO "Approval" (id, "riskId", version, decision, "approverId", snapshot)
    VALUES (gen_random_uuid(), ${riskId}::uuid, 1, ${decision}::"ApprovalDecision", ${approverId}::uuid, '{}'::jsonb)`;
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("risk slice privileges", () => {
  it.each(APPEND_ONLY)("the app role cannot UPDATE or DELETE %s", async (table) => {
    const rows = await app.$queryRawUnsafe<
      {
        upd: boolean;
        del: boolean;
        trunc: boolean;
        ins: boolean;
        sel: boolean;
      }[]
    >(
      `SELECT has_table_privilege('isms_app', '"${table}"', 'UPDATE') AS upd,
              has_table_privilege('isms_app', '"${table}"', 'DELETE') AS del,
              has_table_privilege('isms_app', '"${table}"', 'TRUNCATE') AS trunc,
              has_table_privilege('isms_app', '"${table}"', 'INSERT') AS ins,
              has_table_privilege('isms_app', '"${table}"', 'SELECT') AS sel`,
    );
    expect(rows[0]).toEqual({
      upd: false,
      del: false,
      trunc: false,
      ins: true,
      sel: true,
    });
  });
});

describe("risk slice constraints", () => {
  it("rejects likelihood 6 and an uppercase sha256", async () => {
    const userId = await seedUser();
    await expect(insertRisk(owner, userId, { likelihood: 6 })).rejects.toThrow(/check constraint/);
    const riskId = await insertRisk(owner, userId, { likelihood: 5 });
    await expect(
      owner.$executeRaw`
        INSERT INTO "Evidence" (id, "riskId", "objectKey", "fileName", sha256, "sizeBytes", "mimeType", "uploadedById", "collectedAt")
        VALUES (gen_random_uuid(), ${riskId}::uuid, 'k1', 'f.pdf', ${SHA.toUpperCase()}, 10, 'application/pdf', ${userId}::uuid, now())`,
    ).rejects.toThrow(/check constraint/);
    await owner.$executeRaw`
      INSERT INTO "Evidence" (id, "riskId", "objectKey", "fileName", sha256, "sizeBytes", "mimeType", "uploadedById", "collectedAt")
      VALUES (gen_random_uuid(), ${riskId}::uuid, 'k2', 'f.pdf', ${SHA}, 10, 'application/pdf', ${userId}::uuid, now())`;
  });

  it("refuses a second approved Approval for the same risk version", async () => {
    const userId = await seedUser();
    const riskId = await insertRisk(owner, userId);
    await insertApproval(riskId, userId, "approved");
    await expect(insertApproval(riskId, userId, "approved")).rejects.toThrow(
      /unique constraint|duplicate key|P2010|23505/i,
    );
    await insertApproval(riskId, userId, "returned");
  });

  it("allocates increasing risk references to the app role", async () => {
    const userId = await seedUser();
    const first = await insertRisk(app, userId);
    const second = await insertRisk(app, userId);
    const rows = await owner.$queryRaw<{ reference: number }[]>`
      SELECT reference FROM "Risk" ORDER BY reference`;
    expect(rows).toHaveLength(2);
    const [a, b] = rows.map((r) => r.reference);
    expect(b).toBeGreaterThan(a as number);
    expect(first).not.toBe(second);
  });

  it("keeps asset names unique per type ignoring case and enforces nameKey", async () => {
    await owner.$executeRaw`INSERT INTO "Asset" (id, name, "nameKey", type, "updatedAt") VALUES (gen_random_uuid(), ' Laptop ', 'laptop', 'device', now())`;
    await expect(
      owner.$executeRaw`INSERT INTO "Asset" (id, name, "nameKey", type, "updatedAt") VALUES (gen_random_uuid(), 'LAPTOP', 'laptop', 'device', now())`,
    ).rejects.toThrow(/unique constraint|duplicate key/i);
    await expect(
      owner.$executeRaw`INSERT INTO "Asset" (id, name, "nameKey", type, "updatedAt") VALUES (gen_random_uuid(), 'X', 'wrong', 'service', now())`,
    ).rejects.toThrow(/check constraint/);
  });
});
