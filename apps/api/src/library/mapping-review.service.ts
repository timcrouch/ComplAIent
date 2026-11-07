import { Inject, Injectable } from "@nestjs/common";
import type { MappingDto } from "@isms/contracts";
import { type Clock, DomainError } from "@isms/domain";
import { AuditService, type AuditContext } from "../audit/index.js";
import { CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { MAPPING_SELECT, toMappingDto } from "./mappers.js";

/** A CISO's confirmation that a control meets a requirement. */
@Injectable()
export class MappingReviewService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /**
   * Marks the mapping reviewed by the actor. The first review wins: if the mapping is
   * already reviewed, the existing review is returned and nothing is audited. The update and
   * its audit row share one transaction.
   */
  review(mappingId: string, actorUserId: string, ctx: AuditContext): Promise<MappingDto> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.controlRequirementMapping.findUnique({
        where: { id: mappingId },
        select: { id: true, control: { select: { code: true } } },
      });
      if (!found) throw new DomainError("NOT_FOUND", "Not found");

      const { count } = await tx.controlRequirementMapping.updateMany({
        where: { id: mappingId, reviewedAt: null },
        data: { reviewedById: actorUserId, reviewedAt: this.clock.now() },
      });
      const stored = await tx.controlRequirementMapping.findUniqueOrThrow({
        where: { id: mappingId },
        select: MAPPING_SELECT,
      });
      if (count === 1) {
        await this.audit.record(
          {
            action: "library.mapping_reviewed",
            objectType: "ControlRequirementMapping",
            objectId: mappingId,
            after: {
              controlCode: found.control.code,
              frameworkVersionKey: stored.requirement.frameworkVersion.key,
              requirementRef: stored.requirement.ref,
              reviewedById: actorUserId,
            },
          },
          ctx,
          tx,
        );
      }
      return toMappingDto(stored);
    });
  }
}
