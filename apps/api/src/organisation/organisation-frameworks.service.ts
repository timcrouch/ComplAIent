import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  buildFrameworkSuggestionPrompt,
  FrameworkSuggestionOutput,
  selectFrameworkSuggestions,
} from "@isms/ai";
import {
  type FrameworksInput,
  type OrganisationFrameworkDto,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { type Clock, DomainError } from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, AuditService, type AuditSnapshot } from "../audit/index.js";
import { CLOCK } from "../identity/index.js";
import { FrameworkCatalog } from "../library/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { withSetupLock } from "./setup-lock.js";

const FRAMEWORK_SELECT = {
  id: true,
  frameworkVersionId: true,
  status: true,
  source: true,
  reasoning: true,
  confirmedAt: true,
  confirmedBy: { select: { id: true, displayName: true } },
  frameworkVersion: {
    select: { key: true, label: true, framework: { select: { name: true } } },
  },
} as const satisfies Prisma.OrganisationFrameworkSelect;

type StoredFramework = Prisma.OrganisationFrameworkGetPayload<{
  select: typeof FRAMEWORK_SELECT;
}>;

function toDto(f: StoredFramework): OrganisationFrameworkDto {
  return {
    id: f.id,
    frameworkVersionId: f.frameworkVersionId,
    frameworkVersionKey: f.frameworkVersion.key,
    name: f.frameworkVersion.framework.name,
    versionLabel: f.frameworkVersion.label,
    status: f.status,
    source: f.source,
    reasoning: f.reasoning,
    confirmedBy: f.confirmedBy
      ? { id: f.confirmedBy.id, displayName: f.confirmedBy.displayName }
      : null,
    confirmedAt: f.confirmedAt?.toISOString() ?? null,
  };
}

const snapshot = (f: StoredFramework): AuditSnapshot => ({
  frameworkVersionKey: f.frameworkVersion.key,
  status: f.status,
  source: f.source,
});

const aiUnavailable = (reason: string) =>
  new DomainError("CONFLICT", "The AI cannot suggest frameworks now; choose them by hand", [
    conflictDetail("aiUnavailable", reason, "aiUnavailable"),
  ]);

const SUGGESTION_TIMEOUT_MS = 60_000;
const SUGGESTION_MAX_TOKENS = 2000;

/**
 * The frameworks the organisation follows. The AI may add `suggested` rows; saving the step
 * resolves every suggestion (P3-R16): chosen ones are confirmed keeping `source` and
 * `reasoning`, the others are dismissed. Directly chosen versions are confirmed as `manual`.
 */
@Injectable()
export class OrganisationFrameworksService {
  private readonly logger = new Logger(OrganisationFrameworksService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly catalog: FrameworkCatalog,
    private readonly audit: AuditService,
    private readonly ai: AiGatewayService,
  ) {}

  /** Every organisation framework, suggested and confirmed, by framework version key. */
  async list(db: Prisma.TransactionClient = this.prisma): Promise<OrganisationFrameworkDto[]> {
    const rows = await db.organisationFramework.findMany({
      orderBy: { frameworkVersion: { key: "asc" } },
      select: FRAMEWORK_SELECT,
    });
    return rows.map(toDto);
  }

  /**
   * Confirms each chosen version (an already confirmed one keeps its first confirmation),
   * removes confirmed versions that are no longer chosen and dismisses unchosen suggestions.
   * Unknown ids: 400.
   */
  async set(input: FrameworksInput, ctx: AuditContext): Promise<OrganisationFrameworkDto[]> {
    const confirmedById = ctx.actorUserId;
    if (confirmedById === null) throw new Error("Confirming frameworks needs an acting user");
    const ids = input.frameworkVersionIds;
    const known = new Set((await this.catalog.findByIds(ids)).map((v) => v.id));
    const unknown = ids.flatMap((id, i) =>
      known.has(id)
        ? []
        : [
            {
              path: `frameworkVersionIds.${String(i)}`,
              message: "No such framework version",
            },
          ],
    );
    if (unknown.length > 0) {
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", unknown);
    }

    return withSetupLock(this.prisma, async (tx) => {
      const stored = await tx.organisationFramework.findMany({
        select: FRAMEWORK_SELECT,
      });
      const byVersion = new Map(stored.map((f) => [f.frameworkVersionId, f]));
      const data = {
        status: "confirmed",
        confirmedById,
        confirmedAt: this.clock.now(),
      } as const;

      for (const frameworkVersionId of ids) {
        const existing = byVersion.get(frameworkVersionId);
        if (existing?.status === "confirmed") continue;
        // A confirmed suggestion keeps `source: ai` and its reasoning (P3-R16).
        const confirmed = existing
          ? await tx.organisationFramework.update({
              where: { id: existing.id },
              data,
              select: FRAMEWORK_SELECT,
            })
          : await tx.organisationFramework.create({
              data: { frameworkVersionId, source: "manual", ...data },
              select: FRAMEWORK_SELECT,
            });
        await this.audit.record(
          {
            action: "organisation.framework_confirmed",
            objectType: "OrganisationFramework",
            objectId: confirmed.id,
            ...(existing ? { before: snapshot(existing) } : {}),
            after: snapshot(confirmed),
          },
          ctx,
          tx,
        );
      }

      const chosen = new Set(ids);
      for (const f of stored) {
        if (chosen.has(f.frameworkVersionId)) continue;
        await tx.organisationFramework.delete({
          where: { id: f.id },
          select: { id: true },
        });
        await this.audit.record(
          {
            action:
              f.status === "confirmed"
                ? "organisation.framework_removed"
                : "organisation.framework_suggestion_dismissed",
            objectType: "OrganisationFramework",
            objectId: f.id,
            before: snapshot(f),
          },
          ctx,
          tx,
        );
      }
      return this.list(tx);
    });
  }

  /**
   * Asks the AI which catalog frameworks apply to the organisation's profile. Unknown keys are
   * discarded; each kept one becomes (or refreshes) a `suggested`/`ai` row with its reasoning.
   * A confirmed framework is never downgraded. With AI unavailable: 409 aiUnavailable.<reason>.
   */
  async suggest(ctx: AuditContext): Promise<OrganisationFrameworkDto[]> {
    const actorUserId = ctx.actorUserId;
    if (actorUserId === null) throw new Error("Suggesting frameworks needs an acting user");
    const readiness = await this.ai.readiness("framework_suggestion");
    if (!readiness.ready) throw aiUnavailable(readiness.reason);

    const [organisation, sites, catalog] = await Promise.all([
      // findFirst, not findUnique: a batched findUnique on the Boolean singleton is invalid.
      this.prisma.organisation.findFirst({
        where: { singleton: true },
        select: {
          id: true,
          name: true,
          description: true,
          approximateHeadcount: true,
        },
      }),
      this.prisma.site.findMany({
        distinct: ["countryCode"],
        orderBy: { countryCode: "asc" },
        select: { countryCode: true },
      }),
      this.catalog.list(),
    ]);
    if (!organisation)
      throw new DomainError("CONFLICT", "Save the organisation profile first", [
        conflictDetail("setupIncomplete", "profile"),
      ]);

    const prompt = buildFrameworkSuggestionPrompt(
      {
        name: organisation.name,
        description: organisation.description,
        approximateHeadcount: organisation.approximateHeadcount,
        siteCountries: sites.map((s) => s.countryCode),
      },
      catalog.map((v) => ({
        key: v.key,
        name: v.name,
        versionLabel: v.versionLabel,
      })),
    );
    const result = await this.ai.run("framework_suggestion", {
      ...prompt,
      schema: FrameworkSuggestionOutput,
      schemaName: "framework_suggestion",
      maxTokens: SUGGESTION_MAX_TOKENS,
      timeoutMs: SUGGESTION_TIMEOUT_MS,
      actorUserId,
      object: { type: "Organisation", id: organisation.id },
    });
    if (!result.ok) throw aiUnavailable(result.reason);
    const kept = selectFrameworkSuggestions(
      result.value,
      catalog.map((v) => v.key),
    );
    const versionIdByKey = new Map(catalog.map((v) => [v.key, v.id]));

    const frameworks = await withSetupLock(this.prisma, async (tx) => {
      // Read under the lock: a framework confirmed meanwhile is left as it is.
      const stored = await tx.organisationFramework.findMany({
        select: FRAMEWORK_SELECT,
      });
      const byVersion = new Map(stored.map((f) => [f.frameworkVersionId, f]));
      for (const s of kept) {
        const frameworkVersionId = versionIdByKey.get(s.frameworkVersionKey);
        if (frameworkVersionId === undefined) continue;
        const existing = byVersion.get(frameworkVersionId);
        if (existing?.status === "confirmed") continue;
        const data = {
          status: "suggested",
          source: "ai",
          reasoning: s.reasoning,
        } as const;
        const suggested = existing
          ? await tx.organisationFramework.update({
              where: { id: existing.id },
              data,
              select: FRAMEWORK_SELECT,
            })
          : await tx.organisationFramework.create({
              data: { frameworkVersionId, ...data },
              select: FRAMEWORK_SELECT,
            });
        await this.audit.record(
          {
            action: "organisation.framework_suggested",
            objectType: "OrganisationFramework",
            objectId: suggested.id,
            ...(existing ? { before: snapshot(existing) } : {}),
            after: snapshot(suggested),
          },
          ctx,
          tx,
        );
      }
      return this.list(tx);
    });
    await this.recordInteraction(
      result.interactionId,
      result.value.suggestions.length - kept.length,
    );
    return frameworks;
  }

  /** Best effort: the suggestions are already saved, and these figures are only a measure. */
  private async recordInteraction(interactionId: string, discarded: number): Promise<void> {
    try {
      await this.ai.setDiscardedCount(interactionId, discarded);
    } catch (error) {
      this.logger.warn({
        event: "organisation_frameworks.discarded_count_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    try {
      await this.ai.setOutcome(interactionId, "pending");
    } catch (error) {
      this.logger.warn({
        event: "organisation_frameworks.outcome_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
