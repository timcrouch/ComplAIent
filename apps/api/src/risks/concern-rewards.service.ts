import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@isms/database";
import type { JobsClient } from "@isms/jobs";
import { type AuditContext, AuditService } from "../audit/index.js";
import { JOBS } from "../platform/index.js";

/** Creates the evaluation seam without changing the ordinary risk-reporting transaction. */
@Injectable()
export class ConcernRewardsService {
  private readonly logger = new Logger(ConcernRewardsService.name);

  constructor(
    private readonly audit: AuditService,
    @Inject(JOBS) private readonly jobs: JobsClient,
  ) {}

  async begin(
    tx: Prisma.TransactionClient,
    risk: { id: string; reporterId: string },
    ctx: AuditContext,
  ): Promise<string | null> {
    const organisation = await tx.organisation.findFirst({
      where: { singleton: true },
      select: { concernRewardsEnabled: true },
    });
    if (organisation?.concernRewardsEnabled !== true) return null;

    const evaluation = await tx.concernEvaluation.create({
      data: { riskId: risk.id, reporterId: risk.reporterId },
      select: { id: true },
    });
    await this.audit.record(
      {
        action: "concern.evaluation_queued",
        objectType: "ConcernEvaluation",
        objectId: evaluation.id,
        after: { status: "pending", riskId: risk.id },
      },
      ctx,
      tx,
    );
    return evaluation.id;
  }

  async enqueue(evaluationId: string): Promise<void> {
    try {
      await this.jobs.enqueue(
        "concern.evaluate",
        { evaluationId },
        { idempotencyKey: evaluationId },
      );
    } catch (error) {
      // The report and pending evaluation are already committed; the CISO queue is the fallback.
      this.logger.warn({
        event: "concern_evaluation.enqueue_failed",
        evaluationId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
