import {
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadConfig, storageConfig } from "@isms/config";
import type { RiskDetailDto } from "@isms/contracts";
import request from "supertest";
import { expect } from "vitest";
import { EvidenceModule } from "../../src/evidence/index.js";
import { SystemModule } from "../../src/system/index.js";
import { type Who, db, reportBody, risksHarness } from "../risks/harness.js";

/** Small, so the over-limit case is quick; production uses EVIDENCE_MAX_BYTES (25 MiB). */
export const MAX_BYTES = 64 * 1024;

/**
 * P3-R15: the harness takes the compose stack's MinIO values (as the e2e config does), and
 * keeps test objects in their own bucket next to the configured one.
 */
export const storage = loadConfig(storageConfig, {
  S3_ENDPOINT: `http://localhost:${process.env["MINIO_PORT"] ?? "9000"}`,
  S3_REGION: "eu-central-1",
  S3_BUCKET: "isms-evidence-test",
  S3_ACCESS_KEY_ID: process.env["MINIO_ROOT_USER"],
  S3_SECRET_ACCESS_KEY: process.env["MINIO_ROOT_PASSWORD"],
  S3_FORCE_PATH_STYLE: "true",
  EVIDENCE_MAX_BYTES: String(MAX_BYTES),
});

export const s3 = new S3Client({
  endpoint: storage.S3_ENDPOINT,
  region: storage.S3_REGION,
  forcePathStyle: storage.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: storage.S3_ACCESS_KEY_ID,
    secretAccessKey: storage.S3_SECRET_ACCESS_KEY,
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: storage.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: storage.S3_BUCKET }));
  }
}

/** Every object key under evidence/ in the test bucket. */
export async function objectKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: storage.S3_BUCKET,
        Prefix: "evidence/",
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
    );
    for (const o of page.Contents ?? []) if (o.Key !== undefined) keys.add(o.Key);
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return keys;
}

export function evidenceHarness() {
  const h = risksHarness({
    imports: [EvidenceModule.forRoot({ storage }), SystemModule],
    uploadLimits: { EVIDENCE_MAX_BYTES: MAX_BYTES },
  });

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => {
      done(null, Buffer.concat(chunks));
    });
  };

  type UploadOptions = {
    fileName: string;
    mimeType: string;
    controlIds?: string[];
    classification?: string;
    collectedAt?: string;
  };
  const query = (o: UploadOptions) => ({
    fileName: o.fileName,
    mimeType: o.mimeType,
    ...(o.controlIds === undefined ? {} : { controlIds: o.controlIds.join(",") }),
    ...(o.classification === undefined ? {} : { classification: o.classification }),
    ...(o.collectedAt === undefined ? {} : { collectedAt: o.collectedAt }),
  });

  const upload = async (path: string, who: Who, bytes: Buffer, o: UploadOptions) =>
    request(h.server())
      .post(path)
      .query(query(o))
      .set("authorization", await h.auth(who))
      .set("content-type", "application/octet-stream")
      .send(bytes);

  return {
    ...h,
    async start(): Promise<void> {
      await ensureBucket();
      await h.start();
    },
    async stop(): Promise<void> {
      s3.destroy();
      await h.stop();
    },
    uploadAs: (who: Who, riskId: string, bytes: Buffer, o: UploadOptions) =>
      upload(`/api/v1/risks/${riskId}/evidence`, who, bytes, o),
    uploadForTask: (who: Who, taskId: string, bytes: Buffer, o: UploadOptions) =>
      upload(`/api/v1/tasks/${taskId}/evidence`, who, bytes, o),
    async downloadAs(who: Who, evidenceId: string) {
      return request(h.server())
        .get(`/api/v1/evidence/${evidenceId}/content`)
        .set("authorization", await h.auth(who))
        .buffer(true)
        .parse(binary);
    },
    /** A risk reported in site A with one accepted control (CTL-01) and one only suggested. */
    async riskWithAcceptedControl() {
      const report = await h.post("/api/v1/risks", reportBody({ siteId: h.sites.siteA }), "rita");
      expect(report.status, JSON.stringify(report.body)).toBe(201);
      const risk = report.body as RiskDetailDto;
      const accepted = await control("CTL-01", "Backups are tested");
      const suggested = await control("CTL-02", "Visitors are escorted");
      await db.riskControl.create({
        data: {
          riskId: risk.id,
          controlId: accepted.id,
          status: "accepted",
          source: "person",
          decidedById: h.userIds.cora,
          decidedAt: new Date(),
        },
      });
      await db.riskControl.create({
        data: { riskId: risk.id, controlId: suggested.id, status: "suggested", source: "ai" },
      });
      return { riskId: risk.id, ctl: accepted.id, suggestedCtl: suggested.id };
    },
  };
}

const control = (code: string, title: string) =>
  db.control.create({
    data: { code, title, description: `${title}.`, category: "access", libraryVersion: "t1" },
  });
