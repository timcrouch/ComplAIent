import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const APPEND_ONLY = ["ControlTest", "ControlTestEvidence", "BoardNarrative"];

async function seedUser(): Promise<string> {
  const user = await owner.user.create({
    data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
  });
  return user.id;
}

async function insertRisk(reporterId: string): Promise<string> {
  const rows = await owner.$queryRaw<{ id: string }[]>`
    INSERT INTO "Risk" (id, title, scenario, threat, consequence, "reporterId", "toConfirm", "aiAssisted", "updatedAt")
    VALUES (gen_random_uuid(), 't', 's', 'th', 'c', ${reporterId}::uuid, '{}', false, now())
    RETURNING id::text`;
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

async function insertPeriodicReview(
  riskId: string,
  userId: string,
  status: "open" | "done",
): Promise<void> {
  await owner.$executeRaw`
    INSERT INTO "Task" (id, kind, title, "assigneeId", "requestedById", status, "riskId", "updatedAt")
    VALUES (gen_random_uuid(), 'periodic_review'::"TaskKind", 'review', ${userId}::uuid, ${userId}::uuid, ${status}::"TaskStatus", ${riskId}::uuid, now())`;
}

async function insertControl(): Promise<string> {
  const rows = await owner.$queryRaw<{ id: string }[]>`
    INSERT INTO "Control" (id, code, title, description, guidance, category, "libraryVersion")
    VALUES (gen_random_uuid(), 'C-1', 't', 'd', '{}', 'governance'::"ControlCategory", 'v1')
    RETURNING id::text`;
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

async function insertTest(controlId: string, userId: string, method: string): Promise<void> {
  await app.$executeRaw`
    INSERT INTO "ControlTest" (id, "controlId", "testedOn", result, method, "testedById")
    VALUES (gen_random_uuid(), ${controlId}::uuid, current_date, 'effective'::"ControlTestResult", ${method}, ${userId}::uuid)`;
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("closing the loop privileges", () => {
  it.each(APPEND_ONLY)("the app role cannot UPDATE, DELETE or TRUNCATE %s", async (table) => {
    const rows = await app.$queryRawUnsafe<Record<string, boolean>[]>(
      `SELECT has_table_privilege('isms_app', '"${table}"', 'UPDATE') AS upd,
              has_table_privilege('isms_app', '"${table}"', 'DELETE') AS del,
              has_table_privilege('isms_app', '"${table}"', 'TRUNCATE') AS trunc,
              has_table_privilege('isms_app', '"${table}"', 'INSERT') AS ins,
              has_table_privilege('isms_app', '"${table}"', 'SELECT') AS sel`,
    );
    expect(rows[0]).toEqual({ upd: false, del: false, trunc: false, ins: true, sel: true });
  });
});

describe("reports constraints", () => {
  it("bounds board narrative text to 1-6000 characters", async () => {
    const userId = await seedUser();
    const insert = (text: string) => owner.$executeRaw`
      INSERT INTO "BoardNarrative" (id, "periodKey", "periodStart", "periodEnd", text, "approvedById", "approvedAt")
      VALUES (gen_random_uuid(), '2026-Q4', '2026-10-01', '2026-12-31', ${text}, ${userId}::uuid, now())`;
    await expect(insert("")).rejects.toThrow(/check constraint/);
    await expect(insert("x".repeat(6001))).rejects.toThrow(/check constraint/);
    await insert("x".repeat(6000));
  });

  it("bounds applicability justification to 1-2000 characters", async () => {
    const userId = await seedUser();
    const fw = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO "Framework" (id, key, name, publisher, summary)
      VALUES (gen_random_uuid(), 'f', 'F', 'P', 'S') RETURNING id::text`;
    const ver = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO "FrameworkVersion" (id, "frameworkId", key, label)
      VALUES (gen_random_uuid(), ${fw[0]?.id}::uuid, 'f-1', 'v1') RETURNING id::text`;
    const req = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO "Requirement" (id, "frameworkVersionId", ref, title, "sortOrder")
      VALUES (gen_random_uuid(), ${ver[0]?.id}::uuid, '1', 't', 1) RETURNING id::text`;
    const insert = (justification: string) => owner.$executeRaw`
      INSERT INTO "RequirementApplicability" ("requirementId", applicable, justification, "decidedById", "decidedAt")
      VALUES (${req[0]?.id}::uuid, false, ${justification}, ${userId}::uuid, now())`;
    await expect(insert("")).rejects.toThrow(/check constraint/);
    await expect(insert("x".repeat(2001))).rejects.toThrow(/check constraint/);
    await insert("x".repeat(2000));
  });
});

describe("closing the loop constraints", () => {
  it("allows one open periodic review per risk but any number of closed ones", async () => {
    const userId = await seedUser();
    const riskId = await insertRisk(userId);
    await insertPeriodicReview(riskId, userId, "open");
    await expect(insertPeriodicReview(riskId, userId, "open")).rejects.toThrow(
      /unique constraint|duplicate key|P2010|23505/i,
    );
    await insertPeriodicReview(riskId, userId, "done");
    await insertPeriodicReview(riskId, userId, "done");
    const other = await insertRisk(userId);
    await insertPeriodicReview(other, userId, "open");
  });

  it("limits the review interval to 1-36 months", async () => {
    await owner.$executeRaw`
      INSERT INTO "Organisation" (id, name, "updatedAt") VALUES (gen_random_uuid(), 'o', now())`;
    await expect(
      owner.$executeRaw`UPDATE "Organisation" SET "reviewIntervalMonths" = 0`,
    ).rejects.toThrow(/check constraint/);
    await expect(
      owner.$executeRaw`UPDATE "Organisation" SET "reviewIntervalMonths" = 37`,
    ).rejects.toThrow(/check constraint/);
    await owner.$executeRaw`UPDATE "Organisation" SET "reviewIntervalMonths" = 36`;
  });

  it("bounds the control test method to 1-4000 characters and defaults notes", async () => {
    const userId = await seedUser();
    const controlId = await insertControl();
    await expect(insertTest(controlId, userId, "")).rejects.toThrow(/check constraint/);
    await expect(insertTest(controlId, userId, "x".repeat(4001))).rejects.toThrow(
      /check constraint/,
    );
    await insertTest(controlId, userId, "Sampled access reviews");
    const rows = await owner.$queryRaw<{ notes: string }[]>`SELECT notes FROM "ControlTest"`;
    expect(rows).toEqual([{ notes: "" }]);
  });
});
