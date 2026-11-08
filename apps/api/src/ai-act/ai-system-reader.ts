import { Inject, Injectable } from "@nestjs/common";
import type { AiSystemDetailDto } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError } from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { riskVisibilityWhere } from "../risks/index.js";
import { detailSelect, toDetail } from "./ai-system-view.js";

export const notFound = () => new DomainError("NOT_FOUND", "Not found");

/**
 * Reads one system as the actor may see it. Risk links follow the risk visibility rules, so
 * a scoped reader never sees a link to a risk outside their scope; without risks.read, none.
 */
@Injectable()
export class AiSystemReader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly ai: AiGatewayService,
  ) {}

  /** The risk links the actor may see. */
  visibleRisks(actor: Actor): Prisma.AiSystemRiskWhereInput {
    return this.policy.canAtAnyScope(actor, "risks.read")
      ? { risk: riskVisibilityWhere(actor) }
      : { riskId: { in: [] } };
  }

  async detail(actor: Actor, id: string): Promise<AiSystemDetailDto> {
    const canManage = this.policy.can(actor, "aiact.manage");
    const [row, canDraftClassification, canSuggestGuidance] = await Promise.all([
      this.prisma.aiSystem.findUnique({
        where: { id },
        select: detailSelect(this.visibleRisks(actor)),
      }),
      canManage ? this.ready("ai_act_classification") : false,
      canManage ? this.ready("ai_act_obligation_guidance") : false,
    ]);
    if (!row) throw notFound();
    return toDetail(row, { canDraftClassification, canSuggestGuidance });
  }

  private async ready(
    purpose: "ai_act_classification" | "ai_act_obligation_guidance",
  ): Promise<boolean> {
    return (await this.ai.readiness(purpose)).ready;
  }
}

/** Locks a system's row for the rest of the transaction; 404 when there is none. */
export async function lockSystem(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM "AiSystem" WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}
