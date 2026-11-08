/** Anything that can run a SQL string and return rows (a `pg` client, or an adapter over Prisma). */
export type SqlRunner = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
};

export type TruncateOptions = {
  /**
   * How long one attempt may wait for the table locks, in ms. Must stay below Postgres's
   * `deadlock_timeout` (1 s by default) so the truncate always gives up first.
   */
  lockWaitMs?: number;
  /** Attempts before giving up. */
  attempts?: number;
  /** Waits between attempts (replaced in tests). */
  pause?: (ms: number) => Promise<void>;
};

const SAVEPOINT = "isms_truncate_lock";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteLiteral = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * statement_timeout cancelled the statement (SQLSTATE 57014). node-postgres sets `code`;
 * Prisma reports a raw query's failure as P2010 with the SQLSTATE in `meta` or the message.
 */
function isStatementTimeout(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; message?: unknown; meta?: unknown };
  if (e.code === "57014") return true;
  const text = `${String(e.message)} ${JSON.stringify(e.meta ?? null)}`;
  return text.includes("57014") || text.includes("statement timeout");
}

/**
 * Truncates every table in the public schema except `_prisma_migrations`, restarting identity
 * columns and sequences and cascading. Shared by the demo load and reset (`@isms/demo`) and
 * the test helpers (`@isms/database/testing`). The caller owns the guard (the test helper
 * allows only `*_test` databases, the demo runs it on the owner connection of a demo
 * instance) and the transaction: this must run inside one, because it uses a savepoint.
 *
 * Lock order (#7). All tables are locked first, in ONE `LOCK TABLE` statement, sorted by
 * name, so two truncates always lock in the same order and cannot deadlock with each other.
 * An app transaction may lock tables in any order, so a fixed order alone cannot rule out a
 * cycle with it. Each attempt is therefore bounded by `statement_timeout` (`lockWaitMs`,
 * below `deadlock_timeout`): on a timeout it rolls back to a savepoint, which releases every
 * lock it took, waits, and tries again. The truncate never waits long enough for the deadlock
 * detector to run, so the app transaction is never the one cancelled; it just waits briefly.
 * Once every lock is held, the TRUNCATE itself has nothing left to wait for.
 */
export async function truncateAll(sql: SqlRunner, opts: TruncateOptions = {}): Promise<void> {
  const { lockWaitMs = 200, attempts = 50, pause = sleep } = opts;
  const { rows } = await sql.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const names = rows.map((r) => String(r.tablename)).sort();
  const list = names.map(quoteIdent).join(", ");

  const setting = await sql.query("SELECT current_setting('statement_timeout') AS value");
  const value = setting.rows[0]?.value;
  const previous = typeof value === "string" ? value : "0";
  for (let attempt = 1; ; attempt += 1) {
    await sql.query(`SAVEPOINT ${SAVEPOINT}`);
    await sql.query(`SET LOCAL statement_timeout = ${String(Math.trunc(lockWaitMs))}`);
    try {
      await sql.query(`LOCK TABLE ${list} IN ACCESS EXCLUSIVE MODE`);
    } catch (err) {
      if (!isStatementTimeout(err)) throw err;
      // Undoes the SET LOCAL too, and releases the locks this attempt took.
      await sql.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      if (attempt >= attempts) {
        throw new Error(
          "Could not lock the tables to truncate them: other transactions kept them busy. Try again.",
          { cause: err },
        );
      }
      await pause(Math.min(25 * attempt, 250));
      continue;
    }
    await sql.query(`SELECT set_config('statement_timeout', ${quoteLiteral(previous)}, true)`);
    await sql.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    break;
  }
  await sql.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
