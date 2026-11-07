import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type EvidenceDto, type EvidenceUploadQuery, conflictDetail } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, detectEvidenceType } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService, type RawUpload } from "../platform/index.js";
import {
  EVIDENCE_SELECT,
  RiskQueryService,
  riskScope,
  riskVisibilityWhere,
  toEvidence,
} from "../risks/index.js";
import { cleanFileName } from "./file-check.js";
import {
  OBJECT_STORE,
  ObjectMissingError,
  type ObjectStore,
  ObjectStoreChecksumError,
} from "./object-store.js";

type Tx = Prisma.TransactionClient;
type Control = { id: string; code: string; title: string };

export const conflict = (reason: Parameters<typeof conflictDetail>[0], message: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason)]);
export const notFound = () => new DomainError("NOT_FOUND", "Not found");

/** A uuid v7 (RFC 9562): 48-bit millisecond time, then random bits. */
export function uuidv7(): string {
  const b = randomBytes(16);
  b.writeUIntBE(Date.now(), 0, 6);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One file to store, with what it links to. */
export type NewEvidence = {
  riskId: string;
  taskId?: string;
  /** Read only once every check that needs no bytes has passed. */
  file: RawUpload;
  fileName: string;
  mimeType: string;
  classification: EvidenceUploadQuery["classification"];
  collectedAt?: string | undefined;
  controlIds: string[];
};

/**
 * Extra steps of an upload: `check` runs before the upload and again in the transaction
 * (before the insert); `after` runs in the transaction once the evidence exists.
 */
export type StoreHooks = {
  check?: (db: Tx) => Promise<void>;
  after?: (tx: Tx, evidenceId: string) => Promise<void>;
};

/** An evidence file the actor may download, and its bytes. */
export type EvidenceContent = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  body: Readable;
};

/** Hashed, immutable evidence on S3 (P3-R12). */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly risks: RiskQueryService,
  ) {}

  /** A reviewer attaches a file to accepted controls of a risk, in any state. */
  async upload(
    actor: Actor,
    riskId: string,
    query: EvidenceUploadQuery,
    file: RawUpload,
    ctx: AuditContext,
  ): Promise<EvidenceDto> {
    const risk = await this.risks.getVisible(actor, riskId);
    if (!this.policy.can(actor, "risks.review", riskScope(risk))) throw forbidden();
    const controlIds = [...new Set(query.controlIds)];
    return this.store(actor, { riskId, file, ...query, controlIds }, {}, ctx);
  }

  /**
   * The shared upload flow: type check, SHA-256, put, then the rows and the audit in one
   * transaction; if that fails, the object is deleted again (best effort).
   */
  async store(
    actor: Actor,
    input: NewEvidence,
    hooks: StoreHooks,
    ctx: AuditContext,
  ): Promise<EvidenceDto> {
    const fileName = cleanFileName(input.fileName);
    // Fail fast before reading or uploading; the transaction checks again under its lock.
    const controls = await this.accepted(this.prisma, input.riskId, input.controlIds);
    await hooks.check?.(this.prisma);
    const file = await input.file.read();
    const type = detectEvidenceType(file, input.mimeType, fileName);
    if (!type.ok)
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "file", message: type.reason },
      ]);

    const digest = createHash("sha256").update(file).digest();
    const sha256 = digest.toString("hex");
    const id = uuidv7();
    const objectKey = `evidence/${id}`;
    try {
      await this.objects.put(objectKey, Readable.from([file]), {
        contentType: type.mime,
        sha256Base64: digest.toString("base64"),
        size: file.length,
      });
    } catch (error) {
      if (error instanceof ObjectStoreChecksumError)
        throw conflict("evidenceHashMismatch", "The stored file did not match its hash");
      throw error;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // FOR SHARE: a control cannot be removed while evidence for it is being added.
        await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${input.riskId}::uuid FOR SHARE`;
        await hooks.check?.(tx);
        await this.accepted(tx, input.riskId, input.controlIds);
        await tx.evidence.create({
          data: {
            id,
            riskId: input.riskId,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            objectKey,
            fileName,
            sha256,
            sizeBytes: file.length,
            mimeType: type.mime,
            classification: input.classification,
            uploadedById: actor.userId,
            collectedAt: input.collectedAt === undefined ? new Date() : new Date(input.collectedAt),
            controls: { create: controls.map((c) => ({ controlId: c.id })) },
          },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: "evidence.added",
            objectType: "Evidence",
            objectId: id,
            after: {
              fileName,
              sha256,
              size: file.length,
              mime: type.mime,
              controls: controls.map((c) => c.code),
            },
          },
          ctx,
          tx,
        );
        await hooks.after?.(tx, id);
      });
    } catch (error) {
      await this.removeOrphan(objectKey);
      throw error;
    }
    return toEvidence(
      await this.prisma.evidence.findUniqueOrThrow({ where: { id }, select: EVIDENCE_SELECT }),
    );
  }

  /** The controls, each accepted on the risk, in code order; otherwise 409 controlNotAccepted. */
  private async accepted(tx: Tx, riskId: string, controlIds: string[]): Promise<Control[]> {
    const rows = await tx.riskControl.findMany({
      where: { riskId, status: "accepted", controlId: { in: controlIds } },
      select: { control: { select: { id: true, code: true, title: true } } },
      orderBy: { control: { code: "asc" } },
    });
    if (rows.length !== new Set(controlIds).size)
      throw conflict(
        "controlNotAccepted",
        "Evidence can only support controls accepted on the risk",
      );
    return rows.map((r) => r.control);
  }

  /** Best effort: the object has no row and nobody can reach it; the key alone is logged. */
  private async removeOrphan(key: string): Promise<void> {
    try {
      await this.objects.delete(key);
      this.logger.warn({ event: "evidence.orphan_cleanup", key });
    } catch {
      this.logger.error({ event: "evidence.orphan_cleanup_failed", key });
    }
  }

  /**
   * PF4: a viewer of the risk (risks.read in its scope), or the assignee of the task the
   * evidence completed; anyone else gets 404, whether or not it exists.
   */
  async content(actor: Actor, id: string): Promise<EvidenceContent> {
    const row = await this.prisma.evidence.findFirst({
      where: { id },
      select: {
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        objectKey: true,
        riskId: true,
        task: { select: { assigneeId: true } },
      },
    });
    if (!row) throw notFound();
    if (row.task?.assigneeId !== actor.userId) {
      const risk = await this.prisma.risk.findFirst({
        where: { AND: [{ id: row.riskId }, riskVisibilityWhere(actor)] },
        select: { siteId: true, departmentId: true },
      });
      if (!risk || !this.policy.can(actor, "risks.read", riskScope(risk))) throw notFound();
    }
    let body: Readable;
    try {
      body = await this.objects.get(row.objectKey);
    } catch (error) {
      if (!(error instanceof ObjectMissingError)) throw error;
      this.logger.error({ event: "evidence.object_missing", evidenceId: id });
      throw notFound();
    }
    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      body,
    };
  }
}
