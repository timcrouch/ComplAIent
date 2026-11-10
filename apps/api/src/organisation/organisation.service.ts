import { Inject, Injectable } from "@nestjs/common";
import {
  type CompleteSetupResponse,
  type ConcernRewardsSettingsDto,
  type ConcernRewardsSettingsInput,
  type OrganisationProfileDto,
  type OrganisationResponse,
  type ProfileInput,
  type ReviewIntervalInput,
  type ResumeConcernRewardsResponse,
  type SetupStep,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import type { JobsClient } from "@isms/jobs";
import { type Clock, DEFAULT_REVIEW_INTERVAL_MONTHS, DomainError } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService, enabledModules } from "../platform/index.js";
import { JOBS } from "../platform/index.js";
import { defaultRiskScaleDto } from "./default-risk-scale.js";
import { OrganisationFrameworksService } from "./organisation-frameworks.service.js";
import { OrganisationUnitsService } from "./organisation-units.service.js";
import { RiskScaleService } from "./risk-scale.service.js";
import { withSetupLock } from "./setup-lock.js";

const PROFILE_SELECT = {
  id: true,
  name: true,
  description: true,
  approximateHeadcount: true,
  setupCompletedAt: true,
  reviewIntervalMonths: true,
  concernRewardsEnabled: true,
} as const satisfies Prisma.OrganisationSelect;

type StoredOrganisation = Prisma.OrganisationGetPayload<{ select: typeof PROFILE_SELECT }>;

const toProfile = (o: StoredOrganisation): OrganisationProfileDto => ({
  name: o.name,
  description: o.description,
  approximateHeadcount: o.approximateHeadcount,
});

const sameProfile = (a: OrganisationProfileDto, b: OrganisationProfileDto): boolean =>
  a.name === b.name &&
  a.description === b.description &&
  a.approximateHeadcount === b.approximateHeadcount;

// findFirst, not findUnique: Prisma batches same-tick findUnique calls into one query with
// `singleton: { in: [...] }`, and a Boolean field has no `in` filter (as in prisma-store.ts).
const findOrganisation = (db: Prisma.TransactionClient) =>
  db.organisation.findFirst({ where: { singleton: true }, select: PROFILE_SELECT });

/** The setup steps still to do, in setup order. */
async function missingSteps(db: Prisma.TransactionClient): Promise<SetupStep[]> {
  const missing: SetupStep[] = [];
  if (!(await findOrganisation(db))) missing.push("profile");
  if ((await db.site.count()) === 0) missing.push("sites");
  if ((await db.organisationFramework.count({ where: { status: "confirmed" } })) === 0) {
    missing.push("frameworks");
  }
  if ((await db.riskScale.count()) === 0) missing.push("riskScale");
  return missing;
}

/** The organisation profile, the combined setup view and setup completion. */
@Injectable()
export class OrganisationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly units: OrganisationUnitsService,
    private readonly frameworks: OrganisationFrameworksService,
    private readonly riskScale: RiskScaleService,
    private readonly audit: AuditService,
    @Inject(JOBS) private readonly jobs: JobsClient,
  ) {}

  /** Read in one transaction, so the parts agree with each other. */
  get(): Promise<OrganisationResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const organisation = await findOrganisation(tx);
        return {
          profile: organisation ? toProfile(organisation) : null,
          ...(await this.units.list(tx)),
          frameworks: await this.frameworks.list(tx),
          riskScale: await this.riskScale.current(tx),
          defaultRiskScale: defaultRiskScaleDto(),
          reviewIntervalMonths:
            organisation?.reviewIntervalMonths ?? DEFAULT_REVIEW_INTERVAL_MONTHS,
          concernRewards: { enabled: organisation?.concernRewardsEnabled ?? false },
          setup: {
            completedAt: organisation?.setupCompletedAt?.toISOString() ?? null,
            missing: await missingSteps(tx),
          },
          modules: await enabledModules(tx),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  /** Creates or updates the single organisation row. Unchanged values are not audited. */
  async updateProfile(input: ProfileInput, ctx: AuditContext): Promise<OrganisationResponse> {
    await withSetupLock(this.prisma, async (tx) => {
      const existing = await findOrganisation(tx);
      const before = existing ? toProfile(existing) : undefined;
      if (before && sameProfile(before, input)) return;
      const saved = await tx.organisation.upsert({
        where: { singleton: true },
        create: { singleton: true, ...input },
        update: input,
        select: PROFILE_SELECT,
      });
      await this.audit.record(
        {
          action: "organisation.profile_updated",
          objectType: "Organisation",
          objectId: saved.id,
          before,
          after: toProfile(saved),
        },
        ctx,
        tx,
      );
    });
    // Read after the commit: a concurrent save that commits in between shows up here too,
    // which is what any later read would return anyway.
    return this.get();
  }

  /**
   * Sets the months between periodic reviews. Needs the organisation profile first (409
   * `setupIncomplete.profile`); the same value is a no-op. Already scheduled reviews keep their
   * dates.
   */
  async setReviewInterval(
    input: ReviewIntervalInput,
    ctx: AuditContext,
  ): Promise<OrganisationResponse> {
    await withSetupLock(this.prisma, async (tx) => {
      const existing = await findOrganisation(tx);
      if (!existing) {
        throw new DomainError("CONFLICT", "The organisation profile is not saved yet", [
          conflictDetail("setupIncomplete", "profile"),
        ]);
      }
      if (existing.reviewIntervalMonths === input.months) return;
      const saved = await tx.organisation.update({
        where: { singleton: true },
        data: { reviewIntervalMonths: input.months },
        select: PROFILE_SELECT,
      });
      await this.audit.record(
        {
          action: "organisation.review_interval_changed",
          objectType: "Organisation",
          objectId: saved.id,
          before: { reviewIntervalMonths: existing.reviewIntervalMonths },
          after: { reviewIntervalMonths: saved.reviewIntervalMonths },
        },
        ctx,
        tx,
      );
    });
    return this.get();
  }

  /** Enables or disables rewards independently from AI and leaves ordinary reporting unchanged. */
  async setConcernRewards(
    input: ConcernRewardsSettingsInput,
    ctx: AuditContext,
  ): Promise<ConcernRewardsSettingsDto> {
    return withSetupLock(this.prisma, async (tx) => {
      const existing = await findOrganisation(tx);
      if (!existing) {
        throw new DomainError("CONFLICT", "The organisation profile is not saved yet", [
          conflictDetail("setupIncomplete", "profile"),
        ]);
      }
      if (existing.concernRewardsEnabled === input.enabled) return input;
      let suspended = 0;
      if (!input.enabled) {
        suspended = (
          await tx.concernEvaluation.updateMany({
            where: { status: { in: ["pending", "provisional"] } },
            data: { status: "suspended" },
          })
        ).count;
      }
      const saved = await tx.organisation.update({
        where: { singleton: true },
        data: { concernRewardsEnabled: input.enabled },
        select: { id: true, concernRewardsEnabled: true },
      });
      await this.audit.record(
        {
          action: "organisation.concern_rewards_changed",
          objectType: "Organisation",
          objectId: saved.id,
          before: { enabled: existing.concernRewardsEnabled },
          after: { enabled: saved.concernRewardsEnabled, suspendedEvaluations: suspended },
        },
        ctx,
        tx,
      );
      return { enabled: saved.concernRewardsEnabled };
    });
  }

  async resumeConcernRewards(ctx: AuditContext): Promise<ResumeConcernRewardsResponse> {
    const ids = await withSetupLock(this.prisma, async (tx) => {
      const organisation = await findOrganisation(tx);
      if (!organisation?.concernRewardsEnabled) {
        throw new DomainError("CONFLICT", "Concern rewards are not enabled");
      }
      await tx.concernEvaluation.updateMany({
        where: { status: "suspended", supersededBy: null },
        data: { status: "pending", failureReason: null },
      });
      const pending = await tx.concernEvaluation.findMany({
        where: { status: "pending", supersededBy: null },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "organisation.concern_rewards_resumed",
          objectType: "Organisation",
          objectId: organisation.id,
          after: { evaluations: pending.length },
        },
        ctx,
        tx,
      );
      return pending.map(({ id }) => id);
    });
    let queued = 0;
    for (const evaluationId of ids) {
      try {
        await this.jobs.removeFinished("concern.evaluate", evaluationId);
        await this.jobs.enqueue(
          "concern.evaluate",
          { evaluationId },
          { idempotencyKey: evaluationId },
        );
        queued += 1;
      } catch {
        // It remains pending in the CISO queue and a later explicit resume can retry it.
      }
    }
    return { queued };
  }

  /**
   * Every step done: records who completed setup and when. Steps missing: 409 with
   * `setupIncomplete.<step>` for each. Already complete: the stored time, nothing written.
   */
  complete(ctx: AuditContext): Promise<CompleteSetupResponse> {
    const completedById = ctx.actorUserId;
    if (completedById === null) throw new Error("Completing setup needs an acting user");
    return withSetupLock(this.prisma, async (tx) => {
      const missing = await missingSteps(tx);
      if (missing.length > 0) {
        throw new DomainError(
          "CONFLICT",
          "Setup is not complete",
          missing.map((step) => conflictDetail("setupIncomplete", step)),
        );
      }
      // findFirst, not findUnique: see findOrganisation.
      const organisation = await tx.organisation.findFirstOrThrow({
        where: { singleton: true },
        select: PROFILE_SELECT,
      });
      if (organisation.setupCompletedAt) {
        return { completedAt: organisation.setupCompletedAt.toISOString() };
      }
      const now = this.clock.now();
      const completed = await tx.organisation.update({
        where: { singleton: true },
        data: { setupCompletedAt: now, setupCompletedById: completedById },
        select: { id: true },
      });
      const completedAt = now.toISOString();
      await this.audit.record(
        {
          action: "organisation.setup_completed",
          objectType: "Organisation",
          objectId: completed.id,
          after: { setupCompletedAt: completedAt },
        },
        ctx,
        tx,
      );
      return { completedAt };
    });
  }
}
