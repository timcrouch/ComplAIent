import { databaseTestConfig, loadConfig } from "@isms/config";
import pg from "pg";

/**
 * Guard for destructive test helpers: only databases named `*_test` are allowed.
 * The error never includes the connection string (it carries credentials).
 */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let name = "";
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    // fall through to the refusal below
  }
  assertTestDatabaseName(name);
}

function assertTestDatabaseName(name: string): void {
  if (!name.endsWith("_test")) {
    throw new Error("Refusing to reset database: its name must end in _test");
  }
}

/** Anything that can run a SQL string and return rows (a `pg` client, or an adapter over Prisma). */
export type SqlRunner = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Truncates every table in the public schema except `_prisma_migrations`, restarting identity
 * columns and sequences and cascading. The caller owns the guard: the test helper below allows
 * only `*_test` databases, the demo reset runs it on the owner connection of a demo instance.
 */
export async function truncateAll(sql: SqlRunner): Promise<void> {
  const { rows } = await sql.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${String(r.tablename).replaceAll('"', '""')}"`).join(", ");
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Integration tests only. Truncates every table except `_prisma_migrations`,
 * connecting as the owner role to the test database.
 */
export async function resetTestDatabase(
  ownerTestUrl: string = loadConfig(databaseTestConfig).DATABASE_OWNER_TEST_URL,
): Promise<void> {
  assertTestDatabaseUrl(ownerTestUrl);
  const client = new pg.Client({ connectionString: ownerTestUrl });
  await client.connect();
  try {
    const current = await client.query<{ db: string }>("SELECT current_database() AS db");
    assertTestDatabaseName(current.rows[0]?.db ?? "");
    await truncateAll(client);
  } finally {
    await client.end();
  }
}
