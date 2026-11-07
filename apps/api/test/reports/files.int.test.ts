import { formatRiskReference } from "@isms/domain";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audits, db, detailPaths, type Who } from "../risks/harness.js";
import { reportsHarness } from "./harness.js";
import { readXlsx } from "./xlsx-read.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const today = () => new Date().toISOString().slice(0, 10);

/** Collects a binary body into a Buffer (supertest only buffers text by default). */
function binary(raw: unknown, done: (err: Error | null, body: Buffer) => void) {
  const res = raw as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => {
    done(null, Buffer.concat(chunks));
  });
  res.on("error", (err: Error) => {
    done(err, Buffer.alloc(0));
  });
}

describe("report files", () => {
  const h = reportsHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await h.grant("carl", "auditor", "siteA");
    await db.organisation.create({ data: { name: "Acme Bank" } });
  });
  afterAll(() => h.stop());

  const download = async (path: string, who: Who) => {
    const res = await request(h.server())
      .get(path)
      .set("authorization", await h.auth(who))
      .buffer(true)
      .parse(binary);
    return { status: res.status, headers: res.headers, body: res.body as Buffer };
  };

  async function seedTwo() {
    const riga = await h.seedRisk({ title: "Riga risk", likelihood: 4, impact: 4 }, "siteA");
    const berlin = await h.seedRisk({ title: "Berlin risk", likelihood: 1, impact: 2 }, "siteB");
    return {
      riga: formatRiskReference(riga.reference),
      berlin: formatRiskReference(berlin.reference),
    };
  }

  it("downloads the register as Excel, named by the day, and audits the export", async () => {
    const { riga, berlin } = await seedTwo();
    const res = await download(
      "/api/v1/reports/register.xlsx?filter=all&includeClosed=true",
      "cora",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(XLSX);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="complaient-risk-register-${today()}.xlsx"`,
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Number(res.headers["content-length"])).toBe(res.body.length);
    const strings = readXlsx(res.body).strings(1);
    expect(strings).toEqual(expect.arrayContaining([riga, berlin, "Riga risk"]));
    const rows = await audits("report.exported");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: h.userIds.cora,
      objectType: "report",
      objectId: "register",
      afterRef: {
        kind: "register",
        format: "xlsx",
        filters: { filter: "all", includeClosed: true },
      },
    });
  });

  it("scopes a site auditor's register file to the site", async () => {
    const { riga, berlin } = await seedTwo();
    const res = await download("/api/v1/reports/register.xlsx", "carl");
    expect(res.status).toBe(200);
    const book = readXlsx(res.body);
    expect(book.strings(1)).toContain(riga);
    expect(book.strings(1)).not.toContain(berlin);
    expect(book.strings(2)).toContain("Scope: Riga, plus risks you reported or own");
  });

  it.each([
    ["/api/v1/reports/register.pdf", "risk-register", "register"],
    ["/api/v1/reports/soa.pdf", "soa", "soa"],
    ["/api/v1/reports/board.pdf", "board", "board"],
  ] as const)("downloads %s as a PDF", async (path, name, kind) => {
    await seedTwo();
    const res = await download(path, "cora");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="complaient-${name}-${today()}.pdf"`,
    );
    expect(res.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const rows = await audits("report.exported");
    expect(rows.map((r) => r.afterRef)).toEqual([
      expect.objectContaining({ kind, format: "pdf", filters: expect.any(Object) as unknown }),
    ]);
  });

  it("names the SoA file after its framework version key", async () => {
    const fw = await db.framework.create({
      data: { key: "nist-csf", name: "NIST CSF", publisher: "NIST", summary: "S" },
    });
    const version = await db.frameworkVersion.create({
      data: { frameworkId: fw.id, key: "nist-csf-2.0", label: "2.0" },
    });
    await db.organisationFramework.create({
      data: {
        frameworkVersionId: version.id,
        status: "confirmed",
        source: "manual",
        confirmedById: h.userIds.cora,
        confirmedAt: new Date(),
      },
    });
    const res = await download("/api/v1/reports/soa.pdf", "cora");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="complaient-soa-nist-csf-2.0-${today()}.pdf"`,
    );
  });

  it("downloads the SoA as Excel and records its framework and the board's period", async () => {
    const soa = await download("/api/v1/reports/soa.xlsx", "aldo");
    expect(soa.status).toBe(200);
    expect(soa.headers["content-type"]).toBe(XLSX);
    expect(soa.headers["content-disposition"]).toBe(
      `attachment; filename="complaient-soa-${today()}.xlsx"`,
    );
    const board = await download("/api/v1/reports/board.pdf", "aldo");
    expect(board.status).toBe(200);
    const rows = await audits("report.exported");
    expect(rows.map((r) => r.afterRef)).toEqual([
      { kind: "soa", format: "xlsx", filters: { framework: null } },
      { kind: "board", format: "pdf", filters: { period: expect.any(String) as unknown } },
    ]);
  });

  it("caps the register PDF at 1000 rows while Excel still downloads (P7-R10)", async () => {
    await db.risk.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        title: `Risk ${String(i)}`,
        scenario: "s",
        threat: "t",
        consequence: "c",
        toConfirm: [],
        reporterId: h.userIds.rita,
        aiAssisted: false,
      })),
    });
    const pdf = await request(h.server())
      .get("/api/v1/reports/register.pdf")
      .set("authorization", await h.auth("cora"));
    expect(pdf.status).toBe(409);
    expect(detailPaths(pdf)).toEqual(["reportTooLarge"]);
    expect((await download("/api/v1/reports/register.xlsx", "cora")).status).toBe(200);
    const rows = await audits("report.exported");
    expect(rows.map((r) => r.afterRef)).toEqual([
      expect.objectContaining({ kind: "register", format: "xlsx" }),
    ]);
  });

  it("refuses a reader without reports.read and audits nothing", async () => {
    for (const path of ["/api/v1/reports/register.xlsx", "/api/v1/reports/board.pdf"])
      expect((await download(path, "rita")).status).toBe(403);
    expect(await audits("report.exported")).toEqual([]);
  });

  it("validates the query like the JSON routes", async () => {
    expect((await download("/api/v1/reports/register.pdf?filter=nonsense", "cora")).status).toBe(
      400,
    );
    expect((await download("/api/v1/reports/soa.xlsx?framework=missing", "cora")).status).toBe(404);
    expect(await audits("report.exported")).toEqual([]);
  });
});
