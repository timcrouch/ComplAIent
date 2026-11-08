/** Anything that can run a SQL string and return rows (a `pg` client, or an adapter over Prisma). */
export type SqlRunner = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Truncates every table in the public schema except `_prisma_migrations`, restarting identity
 * columns and sequences and cascading. Shared by the demo load and reset (`@isms/demo`) and
 * the test helpers (`@isms/database/testing`). The caller owns the guard: the test helper
 * allows only `*_test` databases, the demo reset runs it on the owner connection of a demo
 * instance.
 */
export async function truncateAll(sql: SqlRunner): Promise<void> {
  const { rows } = await sql.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${String(r.tablename).replaceAll('"', '""')}"`).join(", ");
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
