import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";

const env = loadConfig(databaseTestConfig);
const app = createPrismaClient(env.DATABASE_TEST_URL);

const SCHEMA_DIR = join(import.meta.dirname, "..", "prisma", "schema");
const MARKER = /^\s*\/\/\/\s*(Append-only|Insert-only)\b/;

/**
 * Real table names of every model whose doc comment is marked Append-only or Insert-only.
 * The doc comment block is the run of `///` lines directly above `model X {`; `@@map` wins.
 */
function appendOnlyTables(): string[] {
  const tables: string[] = [];
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".prisma"))) {
    const lines = readFileSync(join(SCHEMA_DIR, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      const model = /^model\s+(\w+)\s*\{/.exec(line);
      if (!model) return;
      let marked = false;
      for (let j = i - 1; j >= 0 && /^\s*\/\/\//.test(lines[j] ?? ""); j--) {
        if (MARKER.test(lines[j] ?? "")) marked = true;
      }
      if (!marked) return;
      let table = model[1] as string;
      for (let k = i + 1; k < lines.length && !/^\}/.test(lines[k] ?? ""); k++) {
        const map = /^\s*@@map\(\s*"([^"]+)"\s*\)/.exec(lines[k] ?? "");
        if (map) table = map[1] as string;
      }
      tables.push(table);
    });
  }
  return tables.sort();
}

const TABLES = appendOnlyTables();

afterAll(async () => {
  await app.$disconnect();
});

describe("append-only tables derived from the schema", () => {
  it("finds the annotated models (never passes vacuously)", () => {
    expect(TABLES.length).toBeGreaterThan(0);
    expect(TABLES).toEqual(expect.arrayContaining(["RiskScale", "RiskScaleLevel", "AuditEvent"]));
  });

  it.each(TABLES)("the app role cannot UPDATE, DELETE or TRUNCATE %s", async (table) => {
    const rows = await app.$queryRaw<{ upd: boolean; del: boolean; trunc: boolean }[]>`
      SELECT has_table_privilege('isms_app', quote_ident(${table}), 'UPDATE') AS upd,
             has_table_privilege('isms_app', quote_ident(${table}), 'DELETE') AS del,
             has_table_privilege('isms_app', quote_ident(${table}), 'TRUNCATE') AS trunc`;
    expect(rows[0]).toEqual({ upd: false, del: false, trunc: false });
  });
});
