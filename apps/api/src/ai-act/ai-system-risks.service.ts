import { Inject, Injectable } from "@nestjs/common";
import type { AiSystemDetailDto } from "@isms/contracts";
import { type Clock, formatRiskReference } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import { CLOCK, type Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { riskVisibilityWhere } from "../risks/index.js";
import { AiSystemReader, lockSystem, notFound } from "./ai-system-reader.js";
import { conflict, isUniqueViolation } from "./errors.js";

/**
 * Links between AI systems and ISMS risks (#16 §6). The route needs aiact.manage; linking and
 * unlinking also need risks.read (403 without), and only a risk the actor may see can be
 * linked or unlinked: any other is 404, as if it did not exist. The audit trail records the
 * risk's id and reference, never its title.
 */
@Injectable()
export class AiSystemRisksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly reader: AiSystemReader,
  ) {}

  async link(
    actor: Actor,
    id: string,
    riskId: string,
    ctx: AuditContext,
  ): Promise<AiSystemDetailDto> {
    this.assertReadsRisks(actor);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockSystem(tx, id);
        const risk = await tx.risk.findFirst({
          where: { AND: [{ id: riskId }, riskVisibilityWhere(actor)] },
          select: { reference: true },
        });
        if (!risk) throw notFound();
        await tx.aiSystemRisk.create({
          data: { aiSystemId: id, riskId, linkedById: actor.userId, linkedAt: this.clock.now() },
          select: { riskId: true },
        });
        await this.audit.record(
          {
            action: "ai_system.risk_linked",
            objectType: "AiSystem",
            objectId: id,
            after: { riskId, riskReference: formatRiskReference(risk.reference) },
          },
          ctx,
          tx,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict("duplicateAiSystemRisk", "This risk is already linked");
      throw err;
    }
    return this.reader.detail(actor, id);
  }

  async unlink(
    actor: Actor,
    id: string,
    riskId: string,
    ctx: AuditContext,
  ): Promise<AiSystemDetailDto> {
    this.assertReadsRisks(actor);
    await this.prisma.$transaction(async (tx) => {
      await lockSystem(tx, id);
      const link = await tx.aiSystemRisk.findFirst({
        where: { aiSystemId: id, riskId, risk: riskVisibilityWhere(actor) },
        select: { risk: { select: { reference: true } } },
      });
      if (!link) throw notFound();
      await tx.aiSystemRisk.delete({ where: { aiSystemId_riskId: { aiSystemId: id, riskId } } });
      await this.audit.record(
        {
          action: "ai_system.risk_unlinked",
          objectType: "AiSystem",
          objectId: id,
          before: { riskId, riskReference: formatRiskReference(link.risk.reference) },
        },
        ctx,
        tx,
      );
    });
    return this.reader.detail(actor, id);
  }

  private assertReadsRisks(actor: Actor): void {
    if (!this.policy.canAtAnyScope(actor, "risks.read")) throw forbidden();
  }
}
