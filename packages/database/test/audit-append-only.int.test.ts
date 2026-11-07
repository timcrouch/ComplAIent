import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const row = { action: "test", objectType: "x", objectId: "1", requestId: "r" };

describe("AuditEvent is append-only", () => {
  it("allows the app role to insert and read", async () => {
    const e = await app.auditEvent.create({ data: row });
    expect(await app.auditEvent.findUnique({ where: { id: e.id } })).not.toBeNull();
  });

  it("rejects UPDATE and DELETE as the app role by privilege, not trigger", async () => {
    const e = await app.auditEvent.create({ data: row });
    await expect(
      app.$executeRaw`UPDATE "AuditEvent" SET action='changed' WHERE id=${e.id}::uuid`,
    ).rejects.toThrow(/permission denied/);
    await expect(app.$executeRaw`DELETE FROM "AuditEvent" WHERE id=${e.id}::uuid`).rejects.toThrow(
      /permission denied/,
    );
  });

  it("grants the app role only INSERT and SELECT on AuditEvent", async () => {
    const [p] = await owner.$queryRaw<
      { upd: boolean; del: boolean; ins: boolean; sel: boolean }[]
    >`SELECT has_table_privilege('isms_app', '"AuditEvent"', 'UPDATE') AS upd,
             has_table_privilege('isms_app', '"AuditEvent"', 'DELETE') AS del,
             has_table_privilege('isms_app', '"AuditEvent"', 'INSERT') AS ins,
             has_table_privilege('isms_app', '"AuditEvent"', 'SELECT') AS sel`;
    expect(p).toEqual({ upd: false, del: false, ins: true, sel: true });
  });

  it("denies the app role any access to _prisma_migrations", async () => {
    await expect(app.$executeRaw`UPDATE "_prisma_migrations" SET logs = 'x'`).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects TRUNCATE as the app role", async () => {
    await expect(app.$executeRaw`TRUNCATE "AuditEvent"`).rejects.toThrow(/permission denied/);
  });

  it("rejects UPDATE and DELETE even as the owner role (trigger)", async () => {
    const e = await owner.auditEvent.create({ data: row });
    await expect(
      owner.$executeRaw`UPDATE "AuditEvent" SET action='changed' WHERE id=${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.$executeRaw`DELETE FROM "AuditEvent" WHERE id=${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });
});
