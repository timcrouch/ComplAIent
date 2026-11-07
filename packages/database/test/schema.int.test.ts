import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await owner.$disconnect();
});

describe("identity schema", () => {
  it("enforces that an organisation-scoped assignment has no site", async () => {
    const user = await owner.user.create({
      data: { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" },
    });
    const site = await owner.site.create({
      data: { name: "Riga", nameKey: "riga", countryCode: "LV" },
    });
    await expect(
      owner.roleAssignment.create({
        data: {
          userId: user.id,
          role: "administrator",
          scopeType: "ORGANISATION",
          siteId: site.id,
          grantedById: user.id,
        },
      }),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("leaves viewMode unset until chosen and is unique per (issuer, subject)", async () => {
    const data = { idpIssuer: "i", idpSubject: "s", email: "a@example.test", displayName: "A" };
    const user = await owner.user.create({ data });
    expect(user.viewMode).toBeNull();
    await expect(owner.user.create({ data })).rejects.toThrow(/unique/i);
  });

  it("has the vector extension", async () => {
    const rows = await owner.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    expect(rows.map((r) => r.extname)).toContain("vector");
  });
});

describe("risk slice indexes (M-6)", () => {
  it("indexes the foreign-key columns the list and count queries look up", async () => {
    const rows = await owner.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema()`;
    const on = (table: string, cols: string) => `${table}:${cols}`;
    const have = new Set(
      rows.map((r) => {
        const m = /ON \S*?"?(\w+)"? USING btree \((.*)\)/.exec(r.indexdef);
        return m ? on(m[1] ?? "", (m[2] ?? "").replaceAll('"', "")) : "";
      }),
    );
    for (const wanted of [
      on("EvidenceControl", "controlId"),
      on("Evidence", "riskId"),
      on("Task", "riskId, controlId"),
      on("ConcernConversation", "reporterId"),
      on("Risk", "siteId"),
      on("Risk", "departmentId"),
      on("Risk", "updatedAt, id"),
      // Already led by riskId: the unique (riskId, version, decision).
      on("Approval", "riskId, version, decision"),
    ])
      expect(have, wanted).toContain(wanted);
  });
});
