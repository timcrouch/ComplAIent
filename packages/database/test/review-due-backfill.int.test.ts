import { readFileSync } from "node:fs";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

/**
 * The backfill migration is data-only and idempotent, so the test runs its statements again
 * (read from the migration file) against rows seeded after the schema is in place.
 */
const env = loadConfig(databaseTestConfig);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const MIGRATION = new URL(
  "../prisma/migrations/20261107000200_review_due_backfill/migration.sql",
  import.meta.url,
);
const statements = readFileSync(MIGRATION, "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

async function backfill(): Promise<void> {
  for (const sql of statements) await owner.$executeRawUnsafe(sql);
}

let reporterId = "";

async function insertRisk(
  state: string,
  at: { approvedAt?: string; closedAt?: string; nextReviewDue?: string },
): Promise<string> {
  const rows = await owner.$queryRaw<{ id: string }[]>`
    INSERT INTO "Risk" (id, title, scenario, threat, consequence, "reporterId", "toConfirm", "aiAssisted", "updatedAt",
      state, "approvedAt", "closedAt", "nextReviewDue")
    VALUES (gen_random_uuid(), 't', 's', 'th', 'c', ${reporterId}::uuid, '{}', false, now(),
      ${state}::"RiskState", ${at.approvedAt ?? null}::timestamptz, ${at.closedAt ?? null}::timestamptz,
      ${at.nextReviewDue ?? null}::date)
    RETURNING id::text`;
  const row = rows[0];
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

async function due(id: string): Promise<string | null> {
  const rows = await owner.$queryRaw<{ due: string | null }[]>`
    SELECT "nextReviewDue"::text AS due FROM "Risk" WHERE id = ${id}::uuid`;
  return rows[0]?.due ?? null;
}

beforeEach(async () => {
  await resetTestDatabase();
  reporterId = (
    await owner.user.create({
      data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
    })
  ).id;
});
afterAll(async () => {
  await owner.$disconnect();
});

describe("review due backfill migration", () => {
  it("dates approved risks from approval and closed risks from closing, in UTC, 12 months by default", async () => {
    // 23:30 at UTC-2 on 31 Dec is 1 Jan UTC: the UTC date counts.
    const approved = await insertRisk("approved", { approvedAt: "2025-12-31T23:30:00-02:00" });
    const closed = await insertRisk("closed", {
      approvedAt: "2024-01-01T00:00:00Z",
      closedAt: "2025-03-15T10:00:00Z",
    });
    await backfill();
    expect(await due(approved)).toBe("2027-01-01");
    expect(await due(closed)).toBe("2026-03-15");
  });

  it("uses the organisation's interval and clamps to the end of the month", async () => {
    await owner.organisation.create({ data: { name: "Org", reviewIntervalMonths: 1 } });
    const id = await insertRisk("approved", { approvedAt: "2026-01-31T12:00:00Z" });
    await backfill();
    expect(await due(id)).toBe("2026-02-28");
  });

  it("leaves dated, unapproved and timestamp-less risks alone", async () => {
    const dated = await insertRisk("approved", {
      approvedAt: "2025-01-01T00:00:00Z",
      nextReviewDue: "2030-06-01",
    });
    const proposed = await insertRisk("proposed", { approvedAt: "2025-01-01T00:00:00Z" });
    const noStamp = await insertRisk("approved", {});
    const closedNoStamp = await insertRisk("closed", { approvedAt: "2025-01-01T00:00:00Z" });
    await backfill();
    await backfill();
    expect(await due(dated)).toBe("2030-06-01");
    expect(await due(proposed)).toBeNull();
    expect(await due(noStamp)).toBeNull();
    expect(await due(closedNoStamp)).toBeNull();
  });
});
