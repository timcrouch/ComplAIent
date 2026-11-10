import { Body, Controller, Inject } from "@nestjs/common";
import {
  type MeResponse,
  type PreferencesResponse,
  type UpdatePreferencesRequest,
  identityRoutes,
} from "@isms/contracts";
import { concernRank } from "@isms/domain";
import { ContractRoute, PRISMA, type PrismaService, enabledModules } from "../platform/index.js";
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
    const [user, modules, rewardTotal, validatedConcerns] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { id: true, email: true, displayName: true, viewMode: true, theme: true },
      }),
      enabledModules(this.prisma),
      this.prisma.concernRewardEntry.aggregate({
        where: { userId: actor.userId },
        _sum: { points: true },
      }),
      this.prisma.concernEvaluation.count({
        where: {
          reporterId: actor.userId,
          status: { in: ["provisional", "final"] },
          legitimacy: { in: ["confirmed", "plausible", "confirmed_duplicate"] },
        },
      }),
    ]);
    return {
      ...user,
      viewMode: user.viewMode ?? defaultViewMode(actor.roles.map((r) => r.role)),
      theme: user.theme ?? "system",
      roles: actor.roles,
      permissions: this.permissions.permissionsFor(actor),
      // For the navigation (#16 §1); whether the viewer may use a module is in permissions.
      modules,
      concernRank: validatedConcerns > 0 ? concernRank(rewardTotal._sum.points ?? 0).key : null,
    };
  }

  /** Presentation only: grants nothing, so it is not audited (ADR-0005). */
  @ContractRoute(identityRoutes.updatePreferences)
  async updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() body: UpdatePreferencesRequest,
  ): Promise<PreferencesResponse> {
    // Only the fields given change; the other preference keeps its stored value (#2).
    const user = await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        ...(body.viewMode !== undefined ? { viewMode: body.viewMode } : {}),
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
      },
      select: { viewMode: true, theme: true },
    });
    return {
      viewMode: user.viewMode ?? defaultViewMode(actor.roles.map((r) => r.role)),
      theme: user.theme ?? "system",
    };
  }
}
