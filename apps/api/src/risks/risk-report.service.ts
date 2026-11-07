import { Inject, Injectable } from "@nestjs/common";
import { type ReportRiskInput, type RiskDetailDto, conflictDetail } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, formatRiskReference } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { resolveAssets } from "./assets.js";
import { RiskQueryService } from "./risk-query.service.js";
import { writeVersion } from "./risk-versions.js";
import { assertUnitsExist } from "./units.js";

/** How an AI-assisted report differs from a form report (Task 8). */
export type ReportOptions = {
  aiAssisted: true;
  /** The reporter's open conversation; it is marked submitted and linked to the risk. */
  conversationId: string;
  /** From the server-side draft only, never from client input (P3-R5). */
  aiEstimate: { likelihood: number; impact: number; reasoning: string } | null;
};

/** Reporting a risk: it starts proposed, at version 1, waiting for review. */
@Injectable()
export class RiskReportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly query: RiskQueryService,
  ) {}

  async report(
    actor: Actor,
    input: ReportRiskInput,
    ctx: AuditContext,
    opts?: ReportOptions,
  ): Promise<RiskDetailDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertUnitsExist(tx, input, "");
      const estimate = opts?.aiEstimate ?? null;
      const risk = await tx.risk.create({
        data: {
          title: input.title,
          scenario: input.scenario,
          threat: input.threat,
          consequence: input.consequence,
          existingSafeguards: input.existingSafeguards,
          toConfirm: [...input.toConfirm],
          siteId: input.siteId,
          departmentId: input.departmentId,
          reporterId: actor.userId,
          aiAssisted: opts?.aiAssisted ?? false,
          aiLikelihood: estimate?.likelihood ?? null,
          aiImpact: estimate?.impact ?? null,
          aiReasoning: estimate?.reasoning ?? null,
          state: "proposed",
          version: 1,
        },
      });
      const assetIds = await resolveAssets(tx, input.assets, input.siteId);
      if (assetIds.length > 0)
        await tx.riskAsset.createMany({
          data: assetIds.map((assetId) => ({ riskId: risk.id, assetId })),
        });
      if (opts) await this.linkConversation(tx, actor, opts.conversationId, risk.id);
      await writeVersion(tx, risk, [], actor.userId);
      // No free text in the audit history: the reporter's words stay on the risk itself.
      await this.audit.record(
        {
          action: "risk.reported",
          objectType: "Risk",
          objectId: risk.id,
          after: {
            reference: formatRiskReference(risk.reference),
            titleLength: risk.title.length,
            aiAssisted: risk.aiAssisted,
          },
        },
        ctx,
        tx,
      );
      return risk.id;
    });
    return this.query.detail(actor, id);
  }

  /** Marks the reporter's open conversation submitted, in the same transaction. */
  private async linkConversation(
    tx: Prisma.TransactionClient,
    actor: Actor,
    conversationId: string,
    riskId: string,
  ): Promise<void> {
    const { count } = await tx.concernConversation.updateMany({
      where: { id: conversationId, reporterId: actor.userId, status: "open", riskId: null },
      data: { status: "submitted", riskId },
    });
    if (count !== 1)
      throw new DomainError("CONFLICT", "The conversation is no longer open", [
        conflictDetail("conversationClosed"),
      ]);
  }
}
