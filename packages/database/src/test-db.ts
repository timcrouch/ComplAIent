import { databaseTestConfig, loadConfig } from "@isms/config";
import pg from "pg";
import { truncateAll } from "./truncate.js";

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
