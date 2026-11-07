import { Inject, Injectable } from "@nestjs/common";
import type { ConcernTranscriptDto } from "@isms/contracts";
import { DomainError } from "@isms/domain";
import { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { mayReadTranscript, riskVisibilityWhere } from "../risks/index.js";
import { toTranscriptDto } from "./conversation.view.js";

/**
 * Transcripts are restricted (PF5, `mayReadTranscript`): the reporter, an administrator, or a
 * holder of `ai.transcripts.read` at the risk's scope who may also see the risk. Anyone else
 * gets 404, as does a risk without a conversation.
 */
@Injectable()
export class TranscriptService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async forRisk(actor: Actor, riskId: string): Promise<ConcernTranscriptDto> {
    const c = await this.prisma.concernConversation.findUnique({
      where: { riskId },
      include: {
        messages: { orderBy: { seq: "asc" } },
        risk: { select: { siteId: true, departmentId: true } },
      },
    });
    if (!c?.risk || !(await this.mayRead(actor, riskId, c.reporterId, c.risk))) {
      throw new DomainError("NOT_FOUND", "Not found");
    }
    return toTranscriptDto(c);
  }

  private async mayRead(
    actor: Actor,
    riskId: string,
    reporterId: string,
    risk: { siteId: string | null; departmentId: string | null },
  ): Promise<boolean> {
    const visible = await this.prisma.risk.count({
      where: { AND: [{ id: riskId }, riskVisibilityWhere(actor)] },
    });
    return mayReadTranscript(this.policy, actor, {
      conversationReporterId: reporterId,
      siteId: risk.siteId,
      departmentId: risk.departmentId,
      riskVisible: visible > 0,
    });
  }
}
