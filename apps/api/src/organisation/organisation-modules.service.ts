import { Inject, Injectable } from "@nestjs/common";
import type { ModuleKey, ModulesResponse } from "@isms/contracts";
import type { Clock } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService, enabledModules } from "../platform/index.js";

/**
 * Switches optional modules on and off (#16 §1). A row present means on. Turning a module off
 * deletes only that row: the module's data stays, unchanged, for when it is turned back on.
 * Setting the state a module already has writes nothing and is not audited.
 */
@Injectable()
export class OrganisationModulesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async set(key: ModuleKey, enabled: boolean, ctx: AuditContext): Promise<ModulesResponse> {
    const actorId = ctx.actorUserId;
    if (actorId === null) throw new Error("Switching a module needs an acting user");
    return this.prisma.$transaction(async (tx) => {
      // createMany/deleteMany report whether this request changed anything, so two concurrent
      // requests for the same state audit exactly once.
      const { count } = enabled
        ? await tx.organisationModule.createMany({
            data: [{ key, enabledAt: this.clock.now(), enabledById: actorId }],
            skipDuplicates: true,
          })
        : await tx.organisationModule.deleteMany({ where: { key } });
      if (count > 0) {
        await this.audit.record(
          {
            action: enabled ? "organisation.module_enabled" : "organisation.module_disabled",
            objectType: "OrganisationModule",
            objectId: key,
            before: { enabled: !enabled },
            after: { enabled },
          },
          ctx,
          tx,
        );
      }
      return { modules: await enabledModules(tx) };
    });
  }
}
