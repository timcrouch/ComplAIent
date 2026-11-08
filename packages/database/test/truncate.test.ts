import { describe, expect, it } from "vitest";
import { type SqlRunner, truncateAll } from "../src/truncate.js";

const TABLES = ["User", "Approval", "Risk", "AuditEvent", "Control"];
const SORTED = `"Approval", "AuditEvent", "Control", "Risk", "User"`;

/** Records every statement; `lockFailures` LOCK attempts fail with `failWith` first. */
function fakeRunner(opts: { lockFailures?: number; failWith?: Error } = {}) {
  const statements: string[] = [];
  let failures = opts.lockFailures ?? 0;
  const runner: SqlRunner = {
    query(text) {
      statements.push(text);
      if (text.startsWith("SELECT tablename"))
        return Promise.resolve({ rows: TABLES.map((tablename) => ({ tablename })) });
      if (text.startsWith("SELECT current_setting"))
        return Promise.resolve({ rows: [{ value: "0" }] });
      if (text.startsWith("LOCK TABLE") && failures > 0) {
        failures -= 1;
        return Promise.reject(opts.failWith ?? new Error("lock failed"));
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return { runner, statements };
}

/** What node-postgres throws when statement_timeout cancels a statement. */
const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
  code: "57014",
});
const noPause = () => Promise.resolve();

describe("truncateAll", () => {
  it("locks every table in one statement, sorted by name, then truncates them", async () => {
    const { runner, statements } = fakeRunner();
    await truncateAll(runner, { pause: noPause });
    expect(statements.slice(1)).toEqual([
      "SELECT current_setting('statement_timeout') AS value",
      "SAVEPOINT isms_truncate_lock",
      "SET LOCAL statement_timeout = 200",
      `LOCK TABLE ${SORTED} IN ACCESS EXCLUSIVE MODE`,
      "SELECT set_config('statement_timeout', '0', true)",
      "RELEASE SAVEPOINT isms_truncate_lock",
      `TRUNCATE TABLE ${SORTED} RESTART IDENTITY CASCADE`,
    ]);
  });

  it("gives up the locks it took and tries again when the lock wait times out", async () => {
    const { runner, statements } = fakeRunner({ lockFailures: 2, failWith: timeout });
    const pauses: number[] = [];
    await truncateAll(runner, {
      pause: (ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    });
    expect(statements.filter((s) => s.startsWith("LOCK TABLE"))).toHaveLength(3);
    expect(statements.filter((s) => s === "ROLLBACK TO SAVEPOINT isms_truncate_lock")).toHaveLength(
      2,
    );
    expect(pauses).toHaveLength(2);
    expect(statements.at(-1)).toMatch(/^TRUNCATE TABLE/);
  });

  it("recognises the timeout as Prisma reports it from a raw query (P2010)", async () => {
    const prismaTimeout = Object.assign(new Error("Raw query failed. Code: `57014`."), {
      code: "P2010",
      meta: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const { runner, statements } = fakeRunner({ lockFailures: 1, failWith: prismaTimeout });
    await truncateAll(runner, { pause: noPause });
    expect(statements.at(-1)).toMatch(/^TRUNCATE TABLE/);
  });

  it("rethrows any other error at once, without truncating", async () => {
    const denied = Object.assign(new Error("permission denied"), { code: "42501" });
    const { runner, statements } = fakeRunner({ lockFailures: 1, failWith: denied });
    await expect(truncateAll(runner, { pause: noPause })).rejects.toBe(denied);
    expect(statements.some((s) => s.startsWith("TRUNCATE"))).toBe(false);
  });

  it("stops after the last attempt with a clear error, without truncating", async () => {
    const { runner, statements } = fakeRunner({ lockFailures: 99, failWith: timeout });
    await expect(truncateAll(runner, { attempts: 3, pause: noPause })).rejects.toThrow(
      /Could not lock the tables/,
    );
    expect(statements.filter((s) => s.startsWith("LOCK TABLE"))).toHaveLength(3);
    expect(statements.some((s) => s.startsWith("TRUNCATE"))).toBe(false);
  });

  it("does nothing when there are no tables", async () => {
    const statements: string[] = [];
    await truncateAll({
      query(text) {
        statements.push(text);
        return Promise.resolve({ rows: [] });
      },
    });
    expect(statements).toHaveLength(1);
  });
});
