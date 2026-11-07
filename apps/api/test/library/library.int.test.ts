import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import type {
  ControlDetailDto,
  ControlListResponse,
  ExportLibraryResponse,
  ListFrameworksResponse,
  MappingDto,
} from "@isms/contracts";
import { syncControlLibrary } from "@isms/control-library";
import { FIXTURE_LIBRARY } from "@isms/control-library/testing";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationModule } from "../../src/authorization/index.js";
import { IdentityModule } from "../../src/identity/index.js";
import { LibraryModule } from "../../src/library/index.js";
import { InfrastructureModule, PlatformModule, configureApp } from "../../src/platform/index.js";
import { JwksServer, makeKey } from "../identity/jwks-server.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);

const USERS = {
  ciso: { name: "Carl Ciso", role: "ciso" },
  admin: { name: "Anna Admin", role: "administrator" },
  auditor: { name: "Arno Auditor", role: "auditor" },
  reporter: { name: "Rita Reporter", role: "contributor" },
} as const;
type Who = keyof typeof USERS;

describe("control library API", () => {
  let idp: JwksServer;
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    idp = await new JwksServer().start();
    idp.keys = [await makeKey("key-1")];
    const moduleRef = await Test.createTestingModule({
      imports: [
        PlatformModule.forRoot({
          logLevel: "silent",
          service: "isms-api-test",
          rateLimitPerMinute: 1000,
          rateLimitPerIpPerMinute: 1000,
          throttleTrustedIps: [],
        }),
        InfrastructureModule.forRoot({
          databaseUrl: env.DATABASE_TEST_URL,
          redisUrl: env.REDIS_URL,
        }),
        IdentityModule.forRoot({ issuer: idp.issuer, audience: "isms-api" }),
        AuthorizationModule.forRoot(),
        LibraryModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, { trustProxy: false });
    await app.init();
  });

  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
    await syncControlLibrary(db, FIXTURE_LIBRARY);
    for (const [sub, u] of Object.entries(USERS)) {
      const user = await db.user.create({
        data: {
          idpIssuer: idp.issuer,
          idpSubject: sub,
          email: `${sub}@example.test`,
          displayName: u.name,
        },
      });
      await db.roleAssignment.create({
        data: {
          userId: user.id,
          role: u.role,
          scopeType: "ORGANISATION",
          grantedById: user.id,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await idp.stop();
    await db.$disconnect();
  });

  const token = (sub: string) => {
    const now = Math.floor(Date.now() / 1000);
    return idp.sign({
      sub,
      email: `${sub}@example.test`,
      name: USERS[sub as Who].name,
      iat: now,
      exp: now + 300,
      auth_time: now,
    });
  };
  const get = async (path: string, who: Who = "ciso") =>
    request(server())
      .get(path)
      .set("authorization", `Bearer ${await token(who)}`);
  const post = async (path: string, who: Who = "ciso") =>
    request(server())
      .post(path)
      .set("authorization", `Bearer ${await token(who)}`);
  const list = async (query = "", who: Who = "ciso") => {
    const res = await get(`/api/v1/library/controls${query}`, who);
    return { res, body: res.body as ControlListResponse };
  };
  const codes = (b: ControlListResponse) => b.items.map((i) => i.code);
  const mappingId = async (code: string, ref: string) =>
    (
      await db.controlRequirementMapping.findFirstOrThrow({
        where: { control: { code }, requirement: { ref } },
        select: { id: true },
      })
    ).id;

  it("lists frameworks with requirement counts", async () => {
    const res = await get("/api/v1/library/frameworks");
    expect(res.status).toBe(200);
    const { frameworks } = res.body as ListFrameworksResponse;
    expect(frameworks.map((f) => [f.key, f.requirementCount])).toEqual([
      ["gdpr-2016-679", 1],
      ["iso27001-2022", 2],
    ]);
    expect(frameworks.find((f) => f.key === "iso27001-2022")).toMatchObject({
      frameworkKey: "iso27001",
      name: "ISO/IEC 27001",
      versionLabel: "2022",
    });
  });

  it("lists controls sorted by code with mapping counts and the library version", async () => {
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(codes(body)).toEqual(["ACC-01", "GOV-01", "RES-01"]);
    expect(body.libraryVersion).toBe("2026.11.0-test");
    expect(body.items.find((i) => i.code === "RES-01")).toEqual({
      code: "RES-01",
      title: "Back up important data and test restores",
      category: "resilience",
      frameworks: ["gdpr-2016-679", "iso27001-2022"],
      mappings: { total: 2, reviewed: 0 },
      inUse: false,
      latestResult: null,
    });
  });

  it("searches by words in the text", async () => {
    expect(codes((await list("?q=backup")).body)).toEqual(["RES-01"]);
    expect(codes((await list("?q=quarter")).body)).toEqual(["ACC-01"]);
    expect(codes((await list("?q=%20%20")).body)).toEqual(["ACC-01", "GOV-01", "RES-01"]);
  });

  it("searches by control code prefix and by requirement reference", async () => {
    expect(codes((await list("?q=gov")).body)).toEqual(["GOV-01"]);
    expect(codes((await list("?q=A.8.13")).body)).toEqual(["RES-01"]);
    expect(codes((await list("?q=art.%2032")).body)).toEqual(["ACC-01", "RES-01"]);
  });

  it("treats wildcards and tsquery syntax as plain text", async () => {
    expect((await list("?q=%25")).body.items).toEqual([]);
    expect((await list("?q=_")).body.items).toEqual([]);
    const operators = await list(`?q=${encodeURIComponent("a & | ! :* ( '")}`);
    expect(operators.res.status).toBe(200);
    expect(operators.body.items).toEqual([]);
    for (const quoteOrSlash of ["%5C", "%22"]) {
      const res = await list(`?q=${quoteOrSlash}`);
      expect(res.res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
    const tooLong = await list(`?q=${"a".repeat(201)}`);
    expect(tooLong.res.status).toBe(400);
    expect((tooLong.res.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });

  it("treats control characters in the search as spaces, never as a server error", async () => {
    const nul = await list("?q=%00");
    expect(nul.res.status).toBe(200);
    expect(nul.body.items).toEqual([]);
    const inside = await list("?q=a%00b");
    expect(inside.res.status).toBe(200);
    expect(inside.body.items).toEqual([]);
    const words = await list("?q=backup%00restores");
    expect(words.res.status).toBe(200);
    expect(codes(words.body)).toEqual(["RES-01"]);
  });

  it("refuses a framework key that is not a plain slug", async () => {
    for (const bad of ["%00", "a".repeat(101), "GDPR", "-gdpr"]) {
      const res = await list(`?framework=${bad}`);
      expect(res.res.status).toBe(400);
      expect((res.res.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("accepts a framework version key with a dot, matching nothing when absent", async () => {
    const res = await list("?framework=nist-csf-2.0");
    expect(res.res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("filters by framework, category and review status", async () => {
    expect(codes((await list("?framework=gdpr-2016-679")).body)).toEqual(["ACC-01", "RES-01"]);
    expect(codes((await list("?category=governance")).body)).toEqual(["GOV-01"]);
    expect((await list("?category=nonsense")).res.status).toBe(400);
    expect(codes((await list("?review=unreviewed")).body)).toHaveLength(3);
    expect((await list("?review=reviewed")).body.items).toEqual([]);

    // Reviewing RES-01's ISO mapping: still unreviewed overall, but reviewed within ISO.
    expect(
      (await post(`/api/v1/library/mappings/${await mappingId("RES-01", "A.8.13")}/review`)).status,
    ).toBe(200);
    expect(codes((await list("?review=unreviewed")).body)).toEqual(["ACC-01", "GOV-01", "RES-01"]);
    expect(codes((await list("?review=reviewed&framework=iso27001-2022")).body)).toEqual([
      "RES-01",
    ]);
    expect(codes((await list("?review=unreviewed&framework=iso27001-2022")).body)).toEqual([
      "GOV-01",
    ]);
    expect((await list("?review=reviewed")).body.items).toEqual([]);
    expect((await list("?q=backup")).body.items.map((i) => [i.code, i.mappings.reviewed])).toEqual([
      ["RES-01", 1],
    ]);
  });

  it("shows a control's mappings, each with its review status", async () => {
    const res = await get("/api/v1/library/controls/RES-01");
    expect(res.status).toBe(200);
    const dto = res.body as ControlDetailDto;
    expect(dto).toMatchObject({
      code: "RES-01",
      category: "resilience",
      libraryVersion: "2026.11.0-test",
      guidance: ["List what must be backed up.", "Try a restore at least twice a year."],
    });
    expect(dto.mappings).toHaveLength(2);
    expect(dto.mappings.map((m) => m.frameworkVersionKey)).toEqual([
      "gdpr-2016-679",
      "iso27001-2022",
    ]);
    expect(dto.mappings.every((m) => m.review.status === "unreviewed")).toBe(true);
    expect(dto.mappings[1]).toMatchObject({
      frameworkName: "ISO/IEC 27001",
      versionLabel: "2022",
      requirementRef: "A.8.13",
    });
  });

  it("returns 404 NOT_FOUND for an unknown control code, 400 for a malformed one", async () => {
    const res = await get("/api/v1/library/controls/GOV-99");
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    expect((await get("/api/v1/library/controls/nope")).status).toBe(400);
  });

  it("a CISO marks a mapping reviewed; name and date are returned and audited", async () => {
    const id = await mappingId("RES-01", "A.8.13");
    const res = await post(`/api/v1/library/mappings/${id}/review`);
    expect(res.status).toBe(200);
    const dto = res.body as MappingDto;
    expect(dto).toMatchObject({
      id,
      requirementRef: "A.8.13",
      review: { status: "reviewed", reviewedBy: { displayName: "Carl Ciso" } },
    });
    const cisoId = (await db.user.findFirstOrThrow({ where: { displayName: "Carl Ciso" } })).id;
    const stored = await db.controlRequirementMapping.findUniqueOrThrow({ where: { id } });
    expect(stored.reviewedById).toBe(cisoId);

    const events = await db.auditEvent.findMany({ where: { action: "library.mapping_reviewed" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: cisoId,
      objectType: "ControlRequirementMapping",
      objectId: id,
      requestId: res.headers["x-request-id"],
      afterRef: {
        controlCode: "RES-01",
        frameworkVersionKey: "iso27001-2022",
        requirementRef: "A.8.13",
        reviewedById: cisoId,
      },
    });
    const detail = (await get("/api/v1/library/controls/RES-01")).body as ControlDetailDto;
    expect(detail.mappings.map((m) => m.review.status)).toEqual(["unreviewed", "reviewed"]);
  });

  it("reviewing twice keeps the first review and writes one audit row", async () => {
    const id = await mappingId("GOV-01", "A.5.1");
    const first = (await post(`/api/v1/library/mappings/${id}/review`)).body as MappingDto;
    const second = await post(`/api/v1/library/mappings/${id}/review`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first);
    expect(await db.auditEvent.count({ where: { action: "library.mapping_reviewed" } })).toBe(1);
  });

  it("returns 404 when reviewing an unknown mapping", async () => {
    const unknown = "0190a4b8-6f1e-7c3a-9b2d-4e5f6a7b8c9d";
    expect((await post(`/api/v1/library/mappings/${unknown}/review`)).status).toBe(404);
    expect((await post("/api/v1/library/mappings/not-a-uuid/review")).status).toBe(400);
  });

  it("administrators and auditors can read but not review; contributors cannot read", async () => {
    const id = await mappingId("GOV-01", "A.5.1");
    for (const who of ["admin", "auditor"] as const) {
      expect((await get("/api/v1/library/frameworks", who)).status).toBe(200);
      expect((await get("/api/v1/library/export", who)).status).toBe(200);
      const denied = await post(`/api/v1/library/mappings/${id}/review`, who);
      expect(denied.status).toBe(403);
      expect((denied.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    }
    for (const path of [
      "/api/v1/library/frameworks",
      "/api/v1/library/controls",
      "/api/v1/library/controls/GOV-01",
      "/api/v1/library/export",
    ]) {
      const res = await get(path, "reporter");
      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    }
    expect((await post(`/api/v1/library/mappings/${id}/review`, "reporter")).status).toBe(403);
    expect(await db.auditEvent.count({ where: { action: "library.mapping_reviewed" } })).toBe(0);
  });

  it("export returns one row per mapping with its review status", async () => {
    await post(`/api/v1/library/mappings/${await mappingId("GOV-01", "A.5.1")}/review`);
    const res = await get("/api/v1/library/export", "auditor");
    expect(res.status).toBe(200);
    const body = res.body as ExportLibraryResponse;
    expect(body.libraryVersion).toBe("2026.11.0-test");
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(body.rows.map((r) => [r.controlCode, r.frameworkVersionKey, r.requirementRef])).toEqual([
      ["ACC-01", "gdpr-2016-679", "Art. 32"],
      ["GOV-01", "iso27001-2022", "A.5.1"],
      ["RES-01", "gdpr-2016-679", "Art. 32"],
      ["RES-01", "iso27001-2022", "A.8.13"],
    ]);
    expect(body.rows.filter((r) => r.controlCode === "RES-01")).toSatisfy(
      (rows: ExportLibraryResponse["rows"]) =>
        rows.every(
          (r) => r.reviewStatus === "unreviewed" && r.reviewedBy === null && r.reviewedAt === null,
        ),
    );
    expect(body.rows[1]).toMatchObject({
      reviewStatus: "reviewed",
      reviewedBy: "Carl Ciso",
      controlTitle: "Agree and publish your security rules",
      category: "governance",
      frameworkName: "ISO/IEC 27001",
    });
  });
});
