import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { versionSnapshot } from "@isms/demo";
import { afterAll, describe, expect, it } from "vitest";
import { writeVersion } from "../../src/risks/index.js";

const env = loadConfig(databaseTestConfig);
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

/** Thrown to roll the transaction back once the snapshots are read. */
class Rollback extends Error {
  constructor(readonly result: { api: unknown; demo: unknown }[]) {
    super("rollback");
  }
}

afterAll(async () => {
  await db.$disconnect();
});

describe("sample snapshots match writeVersion (snapshot parity)", () => {
  it("writes the same snapshot for an equivalent risk, with and without a lifecycle note", async () => {
    const suffix = String(Date.now());
    let result: { api: unknown; demo: unknown }[] = [];
    try {
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            idpIssuer: "pending:",
            idpSubject: `parity-${suffix}@example.test`,
            email: `parity-${suffix}@example.test`,
            displayName: "Parity",
          },
        });
        const control = await tx.control.create({
          data: {
            code: `PAR-${suffix}`,
            title: "T",
            description: "D",
            guidance: [],
            category: "governance",
            libraryVersion: "test",
          },
        });
        const risk = await tx.risk.create({
          data: {
            title: "Parity",
            scenario: "S",
            threat: "T",
            consequence: "C",
            toConfirm: ["q"],
            likelihood: 4,
            impact: 3,
            residualLikelihood: 2,
            residualImpact: 2,
            treatment: "mitigate",
            treatmentNote: "n",
            state: "closed",
            version: 3,
            reporterId: user.id,
            ownerId: user.id,
            closedAt: new Date("2026-05-06T07:08:09.010Z"),
            closedById: user.id,
            nextReviewDue: new Date("2027-05-06T00:00:00.000Z"),
            aiAssisted: false,
          },
        });
        const assets = [
          { name: `Parity B ${suffix}`, type: "service" as const },
          { name: `Parity A ${suffix}`, type: "device" as const },
        ];
        for (const a of assets) {
          const asset = await tx.asset.create({
            data: { name: a.name, nameKey: a.name.toLowerCase(), type: a.type },
          });
          await tx.riskAsset.create({ data: { riskId: risk.id, assetId: asset.id } });
        }
        await tx.riskControl.create({
          data: {
            riskId: risk.id,
            controlId: control.id,
            status: "accepted",
            source: "person",
            decidedById: user.id,
            decidedAt: new Date(),
          },
        });
        const out: { api: unknown; demo: unknown }[] = [];
        for (const [version, note] of [
          [3, undefined],
          [4, "why"],
        ] as const) {
          const row = await tx.risk.update({ where: { id: risk.id }, data: { version } });
          await writeVersion(tx, row, [], user.id, note);
          const stored = await tx.riskVersion.findUniqueOrThrow({
            where: { riskId_version: { riskId: risk.id, version } },
            select: { snapshot: true },
          });
          out.push({
            api: stored.snapshot,
            demo: versionSnapshot(row, assets, [control.code], note),
          });
        }
        throw new Rollback(out);
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
      result = error.result;
    }
    expect(result).toHaveLength(2);
    for (const { api, demo } of result) {
      expect(Object.keys(demo as object).sort()).toEqual(Object.keys(api as object).sort());
      expect(JSON.parse(JSON.stringify(demo))).toEqual(api);
    }
  });
});
