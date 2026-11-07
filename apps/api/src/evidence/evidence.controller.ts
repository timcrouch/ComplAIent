import { pipeline } from "node:stream/promises";
import { Body, Controller, Logger, Param, Query, Req, Res } from "@nestjs/common";
import {
  type EvidenceDto,
  type EvidenceRequestInput,
  type EvidenceUploadQuery,
  type MyTaskDto,
  type MyTasksResponse,
  type TaskUploadQuery,
  evidenceRoutes,
} from "@isms/contracts";
import type { Request, Response } from "express";
import { auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute, type RawUpload } from "../platform/index.js";
import { EvidenceService } from "./evidence.service.js";
import { contentDisposition } from "./file-check.js";
import { EvidenceIntegrityError, VerifyingStream } from "./integrity.js";
import { TasksService } from "./tasks.service.js";

/** Evidence files on risks, their downloads, and evidence requests as tasks. */
@Controller()
export class EvidenceController {
  private readonly logger = new Logger(EvidenceController.name);

  constructor(
    private readonly evidence: EvidenceService,
    private readonly tasks: TasksService,
  ) {}

  /** The body is the file itself, read by the service once its checks have passed. */
  @ContractRoute(evidenceRoutes.upload)
  upload(
    @Param("id") id: string,
    @Query() query: EvidenceUploadQuery,
    @Body() file: RawUpload,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<EvidenceDto> {
    return this.evidence.upload(actor, id, query, file, auditContextFrom(req));
  }

  @ContractRoute(evidenceRoutes.download)
  async download(
    @Param("id") id: string,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.evidence.content(actor, id);
    res.status(200);
    res.set({
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": contentDisposition(file.fileName),
      "X-Content-Type-Options": "nosniff",
      "X-Evidence-SHA256": file.sha256,
      "Cache-Control": "private, no-store",
    });
    // Headers first, so a failed integrity check shows as a transfer short of its length.
    res.flushHeaders();
    try {
      await pipeline(file.body, new VerifyingStream(file.sha256), res);
    } catch (error) {
      // Headers are sent: the only signal left is a cut connection, short of Content-Length.
      if (error instanceof EvidenceIntegrityError)
        this.logger.error({ event: "evidence.integrity_failure", evidenceId: id });
      else
        this.logger.warn({
          event: "evidence.download_failed",
          evidenceId: id,
          error: error instanceof Error ? error.name : "unknown",
        });
      res.destroy();
    }
  }

  @ContractRoute(evidenceRoutes.requestEvidence)
  requestEvidence(
    @Param("id") id: string,
    @Body() body: EvidenceRequestInput,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<MyTaskDto> {
    return this.tasks.requestEvidence(actor, id, body, auditContextFrom(req));
  }

  @ContractRoute(evidenceRoutes.myTasks)
  myTasks(@CurrentActor() actor: Actor): Promise<MyTasksResponse> {
    return this.tasks.myTasks(actor);
  }

  @ContractRoute(evidenceRoutes.uploadForTask)
  uploadForTask(
    @Param("id") id: string,
    @Query() query: TaskUploadQuery,
    @Body() file: RawUpload,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<EvidenceDto> {
    return this.tasks.uploadForTask(actor, id, query, file, auditContextFrom(req));
  }
}
