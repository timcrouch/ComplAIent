import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Logger } from "@nestjs/common";
import { databaseTestConfig, loadConfig } from "@isms/config";
import type { EvidenceDto, RiskDetailDto } from "@isms/contracts";
import { createPrismaClient } from "@isms/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectStoreChecksumError, createS3ObjectStore } from "../../src/evidence/index.js";
import { audits, db, detailPaths } from "../risks/harness.js";
import { MAX_BYTES, evidenceHarness, objectKeys, s3, storage } from "./harness.js";

const h = evidenceHarness();
beforeAll(() => h.start());
beforeEach(() => h.reset());
afterAll(() => h.stop());

const pdf = (size = 2048) => Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(size)]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const ev = (res: { body: unknown }) => res.body as EvidenceDto;

describe("evidence upload and download", () => {
  it("stores a PDF with the SHA-256 the API computed, and the download matches it byte for byte", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const bytes = pdf();
    const up = await h.uploadAs("cora", riskId, bytes, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      controlIds: [ctl],
    });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(ev(up)).toMatchObject({
      fileName: "policy.pdf",
      sha256: sha(bytes),
      sizeBytes: bytes.length,
      mimeType: "application/pdf",
      classification: "internal",
      uploadedBy: { id: h.userIds.cora, displayName: "Cora Ciso" },
      controls: [{ code: "CTL-01", title: "Backups are tested" }],
    });

    const down = await h.downloadAs("cora", ev(up).id);
    expect(down.status).toBe(200);
    expect(Buffer.compare(down.body as Buffer, bytes)).toBe(0);
    expect(down.headers["x-evidence-sha256"]).toBe(ev(up).sha256);
    expect(down.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(down.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''policy.pdf");
    expect(down.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(down.headers["x-content-type-options"]).toBe("nosniff");
    expect(down.headers["cache-control"]).toBe("private, no-store");

    // The store verified the checksum the API sent, and keeps it.
    const row = await db.evidence.findUniqueOrThrow({ where: { id: ev(up).id } });
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: storage.S3_BUCKET,
        Key: row.objectKey,
        ChecksumMode: "ENABLED",
      }),
    );
    expect(head.ChecksumSHA256).toBe(createHash("sha256").update(bytes).digest("base64"));
    expect(row.objectKey).toBe(`evidence/${row.id}`);

    const [audit] = await audits("evidence.added");
    expect(audit?.objectType).toBe("Evidence");
    expect(audit?.objectId).toBe(row.id);
    expect(audit?.afterRef).toEqual({
      fileName: "policy.pdf",
      sha256: sha(bytes),
      size: bytes.length,
      mime: "application/pdf",
      controls: ["CTL-01"],
    });

    // The risk shows its evidence and counts it per control; the version does not move.
    const detail = (await h.get(`/api/v1/risks/${riskId}`, "cora")).body as RiskDetailDto;
    expect(detail.version).toBe(1);
    expect(detail.evidence).toEqual([ev(up)]);
    expect(detail.controls.find((c) => c.code === "CTL-01")?.evidenceCount).toBe(1);
    expect(detail.controls.find((c) => c.code === "CTL-02")?.evidenceCount).toBe(0);
    expect(detail.can.addEvidence).toBe(true);
  });

  it("refuses empty, oversized and disguised files and cleans the name", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const opts = { fileName: "policy.pdf", mimeType: "application/pdf", controlIds: [ctl] };

    const empty = await h.uploadAs("cora", riskId, Buffer.alloc(0), opts);
    expect(empty.status).toBe(400);
    expect((empty.body as { error: { details: unknown[] } }).error.details[0]).toEqual({
      path: "file",
      message: "empty",
    });

    const big = await h.uploadAs("cora", riskId, pdf(MAX_BYTES), opts);
    expect(big.status).toBe(413);
    expect((big.body as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");

    const exe = Buffer.concat([Buffer.from("MZ"), randomBytes(512)]);
    const disguised = await h.uploadAs("cora", riskId, exe, opts);
    expect(disguised.status).toBe(400);
    expect((disguised.body as { error: { details: unknown[] } }).error.details[0]).toEqual({
      path: "file",
      message: "evidenceTypeNotAllowed",
    });
    const wrongExtension = await h.uploadAs("cora", riskId, pdf(), {
      ...opts,
      fileName: "policy.exe",
    });
    expect(detailPaths(wrongExtension)).toEqual(["file"]);

    const cleaned = await h.uploadAs("cora", riskId, pdf(), {
      ...opts,
      fileName: "../../etc/Access review.pdf",
    });
    expect(cleaned.status, JSON.stringify(cleaned.body)).toBe(201);
    expect(ev(cleaned).fileName).toBe("Access review.pdf");
    expect(await db.evidence.count()).toBe(1);
  });

  it("the same file name twice is stored twice under different keys", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const opts = { fileName: "log.txt", mimeType: "text/plain", controlIds: [ctl] };
    const a = await h.uploadAs("cora", riskId, Buffer.from("first export\n"), opts);
    const b = await h.uploadAs("oscar", riskId, Buffer.from("second export\n"), {
      ...opts,
      classification: "confidential",
      collectedAt: "2026-10-01",
    });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(ev(b)).toMatchObject({
      classification: "confidential",
      collectedAt: "2026-10-01T00:00:00.000Z",
    });
    const rows = await db.evidence.findMany({ select: { objectKey: true, fileName: true } });
    expect(rows.map((r) => r.fileName)).toEqual(["log.txt", "log.txt"]);
    expect(new Set(rows.map((r) => r.objectKey)).size).toBe(2);
    const detail = (await h.get(`/api/v1/risks/${riskId}`, "cora")).body as RiskDetailDto;
    expect(detail.controls.find((c) => c.code === "CTL-01")?.evidenceCount).toBe(2);
  });

  it("evidence must link to an accepted control on the risk", async () => {
    const { riskId, ctl, suggestedCtl } = await h.riskWithAcceptedControl();
    const before = await objectKeys();
    const bytes = pdf();
    const opts = { fileName: "policy.pdf", mimeType: "application/pdf" };

    const suggested = await h.uploadAs("cora", riskId, bytes, {
      ...opts,
      controlIds: [ctl, suggestedCtl],
    });
    expect(suggested.status).toBe(409);
    expect(detailPaths(suggested)).toEqual(["controlNotAccepted"]);

    const none = await h.uploadAs("cora", riskId, bytes, opts);
    expect(none.status).toBe(400);
    expect(detailPaths(none)).toEqual(["controlIds"]);
    const tooMany = await h.uploadAs("cora", riskId, bytes, {
      ...opts,
      controlIds: Array.from({ length: 11 }, () => ctl),
    });
    expect(tooMany.status).toBe(400);

    // Out of scope: Olga reviews site B only, Carl may not review at all, Vera sees nothing.
    expect((await h.uploadAs("olga", riskId, bytes, { ...opts, controlIds: [ctl] })).status).toBe(
      404,
    );
    expect((await h.uploadAs("carl", riskId, bytes, { ...opts, controlIds: [ctl] })).status).toBe(
      403,
    );
    expect((await h.uploadAs("aldo", riskId, bytes, { ...opts, controlIds: [ctl] })).status).toBe(
      403,
    );
    expect(await db.evidence.count()).toBe(0);
    expect(await objectKeys()).toEqual(before);
  });

  it("the app role cannot update or delete evidence", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const up = await h.uploadAs("cora", riskId, pdf(), {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      controlIds: [ctl],
    });
    expect(up.status).toBe(201);
    const app = createPrismaClient(loadConfig(databaseTestConfig).DATABASE_TEST_URL);
    try {
      const id = ev(up).id;
      await expect(
        app.$executeRaw`UPDATE "Evidence" SET "fileName" = 'x.pdf' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        app.$executeRaw`DELETE FROM "EvidenceControl" WHERE "evidenceId" = ${id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(app.$executeRaw`DELETE FROM "Evidence" WHERE id = ${id}::uuid`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await app.$disconnect();
    }
  });

  it("a contributor cannot download evidence of a risk they cannot see", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const up = await h.uploadAs("cora", riskId, pdf(), {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      controlIds: [ctl],
    });
    const id = ev(up).id;
    // Carl is a contributor; Rita reported the risk but holds no risks.read; Olga's scope is
    // site B; Vera views approved risks only.
    for (const who of ["carl", "rita", "olga", "vera"] as const)
      expect((await h.downloadAs(who, id)).status, who).toBe(404);
    expect((await h.downloadAs("aldo", id)).status).toBe(200);
    expect((await h.downloadAs("oscar", id)).status).toBe(200);
    expect((await h.downloadAs("cora", "00000000-0000-7000-8000-000000000000")).status).toBe(404);
  });

  it("the store refuses a body whose checksum does not match, and nothing is kept", async () => {
    const store = createS3ObjectStore(storage);
    const key = `evidence/mismatch-${randomBytes(4).toString("hex")}`;
    const bytes = Buffer.from("some text\n");
    await expect(
      store.put(key, Readable.from([bytes]), {
        contentType: "text/plain",
        sha256Base64: createHash("sha256").update("other").digest("base64"),
        size: bytes.length,
      }),
    ).rejects.toBeInstanceOf(ObjectStoreChecksumError);
    expect((await objectKeys()).has(key)).toBe(false);
  });

  it("a stored file that no longer matches its hash is cut short and logged", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const bytes = pdf(8192);
    const up = await h.uploadAs("cora", riskId, bytes, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      controlIds: [ctl],
    });
    const { id } = ev(up);
    const row = await db.evidence.findUniqueOrThrow({ where: { id } });
    // Same size, other bytes: as if the object had rotted or been replaced at the store.
    const tampered = Buffer.from(bytes);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    await s3.send(
      new PutObjectCommand({ Bucket: storage.S3_BUCKET, Key: row.objectKey, Body: tampered }),
    );
    const errors = vi.spyOn(Logger.prototype, "error");
    try {
      const server = h.server();
      if (!server.listening)
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const auth = await h.auth("cora");
      const got = await new Promise<{ received: number; length: number; complete: boolean }>(
        (resolve) => {
          const req = httpRequest({
            host: "127.0.0.1",
            port,
            path: `/api/v1/evidence/${id}/content`,
            headers: { authorization: auth },
          });
          req.on("response", (res) => {
            let received = 0;
            const length = Number(res.headers["content-length"]);
            res.on("data", (c: Buffer) => (received += c.length));
            const done = () => {
              resolve({ received, length, complete: res.complete });
            };
            res.on("end", done);
            res.on("aborted", done);
            res.on("error", done);
          });
          req.on("error", () => {
            resolve({ received: -1, length: -1, complete: false });
          });
          req.end();
        },
      );
      expect(got.length).toBe(bytes.length);
      expect(got.complete).toBe(false);
      expect(got.received).toBeLessThan(bytes.length);
      const logged = errors.mock.calls.map((c) => c[0] as { event?: string; evidenceId?: string });
      expect(logged).toContainEqual({ event: "evidence.integrity_failure", evidenceId: id });
    } finally {
      errors.mockRestore();
    }
  });

  it("a missing object is 404 and logged as evidence.object_missing", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const up = await h.uploadAs("cora", riskId, pdf(), {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      controlIds: [ctl],
    });
    const row = await db.evidence.findUniqueOrThrow({ where: { id: ev(up).id } });
    await s3.send(new DeleteObjectCommand({ Bucket: storage.S3_BUCKET, Key: row.objectKey }));
    const errors = vi.spyOn(Logger.prototype, "error");
    try {
      const down = await h.downloadAs("cora", row.id);
      expect(down.status).toBe(404);
      const logged = errors.mock.calls.map((c) => c[0] as { event?: string });
      expect(logged).toContainEqual({ event: "evidence.object_missing", evidenceId: row.id });
    } finally {
      errors.mockRestore();
    }
  });

  it("readiness reports storage", async () => {
    const res = await request(h.server()).get("/api/v1/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: { postgres: "ok", redis: "ok", storage: "ok" },
    });
  });
});
