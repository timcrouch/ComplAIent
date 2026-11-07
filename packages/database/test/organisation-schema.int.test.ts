import { databaseTestConfig, loadConfig } from "@isms/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/client.js";
import { resetTestDatabase } from "../src/test-db.js";

const env = loadConfig(databaseTestConfig);
const owner = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const app = createPrismaClient(env.DATABASE_TEST_URL);

const makeUser = (n = "s") =>
  owner.user.create({
    data: {
      idpIssuer: "i",
      idpSubject: n,
      email: `${n}@example.test`,
      displayName: n,
    },
  });
const makeSite = (name = "Riga", nameKey = name.trim().toLowerCase()) =>
  owner.site.create({ data: { name, nameKey, countryCode: "LV" } });

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

describe("organisation", () => {
  it("allows only one Organisation row", async () => {
    await owner.organisation.create({ data: { name: "A" } });
    await expect(owner.organisation.create({ data: { name: "B" } })).rejects.toThrow(/unique/i);
    await expect(
      owner.organisation.create({ data: { name: "B", singleton: false } }),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("rejects an implausible headcount", async () => {
    await expect(
      owner.organisation.create({
        data: { name: "A", approximateHeadcount: 0 },
      }),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

describe("sites and departments", () => {
  it("site and department names are unique ignoring case", async () => {
    await makeSite("Riga");
    await expect(makeSite("RIGA ", "riga")).rejects.toThrow(/unique/i);
    await expect(makeSite("Riga", "other")).rejects.toThrow(/check constraint|violates/i);
    await owner.department.create({ data: { name: "IT", nameKey: "it" } });
    await expect(owner.department.create({ data: { name: "it", nameKey: "it" } })).rejects.toThrow(
      /unique/i,
    );
    await expect(
      owner.department.create({ data: { name: "Ops", nameKey: "OPS" } }),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("rejects a country code that is not two capital letters", async () => {
    for (const countryCode of ["lv", "L1", "LVA"]) {
      await expect(
        owner.site.create({ data: { name: "S", nameKey: "s", countryCode } }),
      ).rejects.toThrow(/check constraint|violates|too long/i);
    }
  });

  it("a site used by a role assignment or an asset cannot be deleted", async () => {
    const user = await makeUser();
    const site = await makeSite("Riga");
    const other = await makeSite("Berlin");
    await owner.roleAssignment.create({
      data: {
        userId: user.id,
        role: "ciso",
        scopeType: "SITE",
        siteId: site.id,
        grantedById: user.id,
      },
    });
    await owner.asset.create({
      data: { name: "Server", nameKey: "server", type: "device", siteId: other.id },
    });
    await expect(owner.site.delete({ where: { id: site.id } })).rejects.toThrow(/foreign key/i);
    await expect(owner.site.delete({ where: { id: other.id } })).rejects.toThrow(/foreign key/i);
  });
});

describe("role assignment scope", () => {
  it("scope columns must match the scope type", async () => {
    const user = await makeUser();
    const site = await makeSite();
    const dept = await owner.department.create({
      data: { name: "IT", nameKey: "it" },
    });
    const base = {
      userId: user.id,
      role: "ciso",
      grantedById: user.id,
    } as const;
    const bad = [
      { scopeType: "SITE" },
      { scopeType: "ORGANISATION", siteId: site.id },
      { scopeType: "SITE", departmentId: dept.id },
      { scopeType: "SITE", siteId: site.id, departmentId: dept.id },
      { scopeType: "DEPARTMENT", siteId: site.id },
      { scopeType: "DEPARTMENT" },
    ] as const;
    for (const extra of bad) {
      await expect(owner.roleAssignment.create({ data: { ...base, ...extra } })).rejects.toThrow(
        /check constraint|violates/i,
      );
    }
    await owner.roleAssignment.create({
      data: { ...base, scopeType: "DEPARTMENT", departmentId: dept.id },
    });
  });

  it("organisation-scoped assignments stay unique", async () => {
    const user = await makeUser();
    const data = {
      userId: user.id,
      role: "administrator",
      scopeType: "ORGANISATION",
      grantedById: user.id,
    } as const;
    await owner.roleAssignment.create({ data });
    await expect(owner.roleAssignment.create({ data })).rejects.toThrow(/unique/i);
  });
});

describe("organisation frameworks", () => {
  it("a confirmed organisation framework records who confirmed it and when", async () => {
    const user = await makeUser();
    const fw = await owner.framework.create({
      data: { key: "f", name: "F", publisher: "P", summary: "S" },
    });
    const version = await owner.frameworkVersion.create({
      data: { frameworkId: fw.id, key: "f-1", label: "1" },
    });
    await expect(
      owner.organisationFramework.create({
        data: {
          frameworkVersionId: version.id,
          status: "confirmed",
          source: "manual",
        },
      }),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      owner.organisationFramework.create({
        data: {
          frameworkVersionId: version.id,
          status: "suggested",
          source: "ai",
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/check constraint|violates/i);
    await owner.organisationFramework.create({
      data: {
        frameworkVersionId: version.id,
        status: "confirmed",
        source: "manual",
        confirmedById: user.id,
        confirmedAt: new Date(),
      },
    });
    await expect(
      owner.organisationFramework.create({
        data: {
          frameworkVersionId: version.id,
          status: "suggested",
          source: "ai",
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});

describe("risk scale", () => {
  const level = (axis: "likelihood" | "impact", value: number) => ({
    axis,
    value,
    label: `L${String(value)}`,
    description: "d",
  });

  it("risk scale versions are append-only for the app role", async () => {
    const user = await makeUser();
    const scale = await owner.riskScale.create({
      data: {
        version: 1,
        appetiteThreshold: 12,
        createdById: user.id,
        levels: { create: [level("likelihood", 1), level("impact", 1)] },
      },
    });
    await expect(app.riskScale.findMany()).resolves.toHaveLength(1);
    await expect(
      app.riskScale.update({
        where: { id: scale.id },
        data: { appetiteThreshold: 3 },
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(app.riskScale.delete({ where: { id: scale.id } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(app.riskScaleLevel.updateMany({ data: { label: "x" } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(app.riskScaleLevel.deleteMany()).rejects.toThrow(/permission denied/i);
    await expect(
      app.riskScale.create({
        data: { version: 2, appetiteThreshold: 10, createdById: user.id },
      }),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      app.riskScale.create({
        data: { version: 2, appetiteThreshold: 10, createdById: user.id },
      }),
    ).rejects.toThrow(/unique/i);
  });

  it("risk scale levels are 1-5 and the appetite 1-24", async () => {
    const user = await makeUser();
    for (const appetiteThreshold of [0, 25]) {
      await expect(
        owner.riskScale.create({
          data: { version: 1, appetiteThreshold, createdById: user.id },
        }),
      ).rejects.toThrow(/check constraint|violates/i);
    }
    const scale = await owner.riskScale.create({
      data: { version: 1, appetiteThreshold: 24, createdById: user.id },
    });
    for (const value of [0, 6]) {
      await expect(
        owner.riskScaleLevel.create({
          data: { riskScaleId: scale.id, ...level("impact", value) },
        }),
      ).rejects.toThrow(/check constraint|violates/i);
    }
    await owner.riskScaleLevel.create({
      data: { riskScaleId: scale.id, ...level("impact", 5) },
    });
    await expect(
      owner.riskScaleLevel.create({
        data: { riskScaleId: scale.id, ...level("impact", 5) },
      }),
    ).rejects.toThrow(/unique/i);
  });
});
