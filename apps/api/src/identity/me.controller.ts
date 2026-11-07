import { Body, Controller, Inject } from "@nestjs/common";
import {
  type MeResponse,
  type PreferencesResponse,
  type UpdatePreferencesRequest,
  identityRoutes,
} from "@isms/contracts";
import { ContractRoute, PRISMA, type PrismaService } from "../platform/index.js";
import { type Actor, CurrentActor } from "./actor.js";
import { PERMISSIONS_PROVIDER, type PermissionsProvider } from "./permissions.js";
import { defaultViewMode } from "./view-mode.js";

@Controller()
export class MeController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(PERMISSIONS_PROVIDER)
    private readonly permissions: PermissionsProvider,
  ) {}

  @ContractRoute(identityRoutes.me)
  async me(@CurrentActor() actor: Actor): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { id: true, email: true, displayName: true, viewMode: true },
    });
    return {
      ...user,
      viewMode: user.viewMode ?? defaultViewMode(actor.roles.map((r) => r.role)),
      roles: actor.roles,
      permissions: this.permissions.permissionsFor(actor),
    };
  }

  /** Presentation only: grants nothing, so it is not audited (ADR-0005). */
  @ContractRoute(identityRoutes.updatePreferences)
  async updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() body: UpdatePreferencesRequest,
  ): Promise<PreferencesResponse> {
    await this.prisma.user.update({
      where: { id: actor.userId },
      data: { viewMode: body.viewMode },
      select: { id: true },
    });
    return { viewMode: body.viewMode };
  }
}
