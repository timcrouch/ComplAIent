import { type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RouteDef } from "@isms/contracts";
import { DomainError } from "@isms/domain";
import { CONTRACT_ROUTE, PRISMA, type PrismaService, isModuleEnabled } from "../platform/index.js";

/**
 * Off means it does not exist (#16 §1): a route of an optional module (`RouteDef.module`)
 * answers 404 NOT_FOUND while the module is off, whoever asks. AccessGuard runs it after
 * authentication and before the permission check, so a caller without the permission learns
 * nothing more than one with it. Read per request: switching a module takes effect at once.
 */
@Injectable()
export class ModuleGate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaService,
  ) {}

  async check(context: ExecutionContext): Promise<void> {
    const route = this.reflector.get<RouteDef | undefined>(CONTRACT_ROUTE, context.getHandler());
    if (route?.module === undefined) return;
    if (!(await isModuleEnabled(this.prisma, route.module)))
      throw new DomainError("NOT_FOUND", "Not found");
  }
}
