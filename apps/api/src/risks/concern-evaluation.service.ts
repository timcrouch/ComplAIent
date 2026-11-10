import { Inject, Injectable } from "@nestjs/common";
import type {
  ConcernEvaluationDto,
  ConcernEvaluationQueueDto,
  JudgeConcernInput,
  SecurityContributionDto,
} from "@isms/contracts";
import type { ConcernBadgeKey as DbBadgeKey, Prisma } from "@isms/database";
import {
  CONCERN_BADGES,
  CONCERN_RANKS,
  concernBadgeOccurrences,
  concernRank,
  DomainError,
  formatRiskReference,
  scoreConcern,
  type ConcernBadgeKey,
} from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";

type Tx = Prisma.TransactionClient;
type EvaluationRow = Prisma.ConcernEvaluationGetPayload<{
  include: { risk: { select: { reference: true } } };
}>;

const badgeOccurrenceKey = (badgeKey: ConcernBadgeKey, evaluationId: string) =>
  `${badgeKey}:${evaluationId}`;

function dto(row: EvaluationRow): ConcernEvaluationDto {
  return {
    id: row.id,
    riskId: row.riskId,
    riskReference: formatRiskReference(row.risk.reference),
    status: row.status,
    source: row.source,
    legitimacy: row.legitimacy,
    severity: row.severity,
    confidence: row.confidence,
    duplicatePosition: row.duplicatePosition,
    points: {
      legitimacy: row.legitimacyPoints,
      severity: row.severityPoints,
      position: row.positionPoints,
      total: row.totalPoints,
    },
    feedback: row.feedback,
    requiresReview: row.requiresReview,
    evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const currentWhere = { supersededBy: null } as const;

@Injectable()
export class ConcernEvaluationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async get(actor: Actor, riskId: string): Promise<ConcernEvaluationDto> {
    const row = await this.prisma.concernEvaluation.findFirst({
      where: { riskId, ...currentWhere },
      include: { risk: { select: { reference: true } } },
    });
    if (!row || (row.reporterId !== actor.userId && !this.policy.can(actor, "concerns.judge"))) {
      throw new DomainError("NOT_FOUND", "Not found");
    }
    return dto(row);
  }

  async contribution(actor: Actor): Promise<SecurityContributionDto> {
    const [organisation, ledger, recent, badgeEvents] = await Promise.all([
      this.prisma.organisation.findFirst({
        where: { singleton: true },
        select: { concernRewardsEnabled: true },
      }),
      this.prisma.concernRewardEntry.findMany({
        where: { userId: actor.userId },
        include: { evaluation: { select: { status: true } } },
      }),
      this.prisma.concernEvaluation.findMany({
        where: { reporterId: actor.userId, ...currentWhere },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { risk: { select: { reference: true } } },
      }),
      this.prisma.concernBadgeEvent.findMany({
        where: { userId: actor.userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const total = Math.max(
      0,
      ledger.reduce((sum, entry) => sum + entry.points, 0),
    );
    const provisional = ledger
      .filter((entry) => entry.evaluation.status === "provisional")
      .reduce((sum, entry) => sum + entry.points, 0);
    const rank = concernRank(total);
    const next = CONCERN_RANKS.find((candidate) => candidate.minimumPoints > total) ?? null;
    const active = new Map<string, (typeof badgeEvents)[number]>();
    for (const event of badgeEvents) {
      const key = badgeOccurrenceKey(event.badgeKey, event.evaluationId);
      if (event.kind === "awarded") active.set(key, event);
      else active.delete(key);
    }
    const grouped = new Map<ConcernBadgeKey, (typeof badgeEvents)[number][]>();
    for (const event of active.values()) {
      const events = grouped.get(event.badgeKey) ?? [];
      events.push(event);
      grouped.set(event.badgeKey, events);
    }
    return {
      enabled: organisation?.concernRewardsEnabled ?? false,
      points: { total, provisional },
      rank: { ...rank, next: next ? { ...next } : null },
      badges: [...grouped.entries()].map(([badgeKey, events]) => {
        const times = events.map((event) => event.createdAt.getTime());
        return {
          key: badgeKey,
          ...CONCERN_BADGES[badgeKey],
          image: `/images/concern-rewards/badges/${badgeKey.replaceAll("_", "-")}.png`,
          count: events.length,
          firstAwardedAt: new Date(Math.min(...times)).toISOString(),
          lastAwardedAt: new Date(Math.max(...times)).toISOString(),
        };
      }),
      recent: recent.map(dto),
    };
  }

  async queue(): Promise<ConcernEvaluationQueueDto> {
    const rows = await this.prisma.concernEvaluation.findMany({
      where: {
        ...currentWhere,
        status: { in: ["pending", "provisional"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        risk: { select: { reference: true, title: true } },
        reporter: { select: { id: true, displayName: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        evaluation: dto(row),
        title: row.risk.title,
        reporter: row.reporter,
        rationale: row.rationale,
        uncertainty: row.uncertainty,
        failureReason: row.failureReason,
      })),
    };
  }

  async judge(
    actor: Actor,
    riskId: string,
    input: JudgeConcernInput,
    ctx: AuditContext,
  ): Promise<ConcernEvaluationDto> {
    if (!this.policy.can(actor, "concerns.judge")) throw forbidden();
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('isms:concern-rewards'))`;
      const current = await tx.concernEvaluation.findFirst({
        where: { riskId, ...currentWhere },
        include: { risk: { select: { createdAt: true } } },
      });
      if (!current) throw new DomainError("NOT_FOUND", "Not found");
      if (current.reporterId === actor.userId) throw forbidden();
      const enabled = await tx.organisation.findFirst({
        where: { singleton: true },
        select: { concernRewardsEnabled: true },
      });
      if (enabled?.concernRewardsEnabled !== true) throw forbidden();

      const { groupId, position } = await this.groupPosition(tx, current, input.duplicateRiskId);
      const score = scoreConcern({
        legitimacy: input.legitimacy,
        severity: input.severity,
        position,
      });
      await tx.concernEvaluation.update({
        where: { id: current.id },
        data: { status: "overridden" },
      });
      const replacement = await tx.concernEvaluation.create({
        data: {
          riskId,
          version: current.version + 1,
          reporterId: current.reporterId,
          status: "final",
          source: "ciso",
          legitimacy: input.legitimacy,
          severity: input.severity,
          duplicateGroupId: groupId,
          duplicatePosition: position,
          legitimacyPoints: score.legitimacyPoints,
          severityPoints: score.severityPoints,
          positionPoints: score.positionPoints,
          totalPoints: score.total,
          feedback: input.feedback,
          rationale: input.rationale,
          policyVersion: 1,
          requiresReview: false,
          evaluatedById: actor.userId,
          evaluatedAt: new Date(),
          supersedesId: current.id,
        },
      });
      await tx.concernRewardEntry.create({
        data: {
          evaluationId: replacement.id,
          userId: replacement.reporterId,
          kind: "adjustment",
          points: score.total - current.totalPoints,
          legitimacyPoints: score.legitimacyPoints - current.legitimacyPoints,
          severityPoints: score.severityPoints - current.severityPoints,
          positionPoints: score.positionPoints - current.positionPoints,
          note: "CISO final judgment",
          createdById: actor.userId,
        },
      });
      const affected = new Set<string>([replacement.reporterId]);
      for (const group of new Set([current.duplicateGroupId, groupId])) {
        if (!group) continue;
        for (const changed of await this.rebalanceGroup(tx, group, actor.userId)) {
          affected.add(changed.reporterId);
        }
      }
      for (const reporterId of affected) {
        await this.reconcileBadges(tx, reporterId);
      }
      await this.audit.record(
        {
          action:
            current.source === "ai" ? "concern.evaluation_overridden" : "concern.evaluated_by_ciso",
          objectType: "ConcernEvaluation",
          objectId: replacement.id,
          before: {
            evaluationId: current.id,
            legitimacy: current.legitimacy,
            severity: current.severity,
            points: current.totalPoints,
          },
          after: {
            legitimacy: input.legitimacy,
            severity: input.severity,
            points: score.total,
            version: replacement.version,
          },
        },
        ctx,
        tx,
      );
      return replacement.id;
    });
    const saved = await this.prisma.concernEvaluation.findUniqueOrThrow({
      where: { id },
      include: { risk: { select: { reference: true } } },
    });
    return dto(saved);
  }

  private async groupPosition(
    tx: Tx,
    current: { riskId: string; duplicateGroupId: string | null },
    duplicateRiskId: string | null,
  ): Promise<{ groupId: string; position: number }> {
    if (duplicateRiskId && duplicateRiskId !== current.riskId) {
      const target = await tx.concernEvaluation.findFirst({
        where: { riskId: duplicateRiskId, duplicateGroupId: { not: null }, ...currentWhere },
        select: { duplicateGroupId: true },
      });
      if (target?.duplicateGroupId) {
        const members = await tx.concernEvaluation.count({
          where: {
            duplicateGroupId: target.duplicateGroupId,
            riskId: { not: current.riskId },
            ...currentWhere,
          },
        });
        return { groupId: target.duplicateGroupId, position: members + 1 };
      }
    }
    return { groupId: (await tx.concernDuplicateGroup.create({ data: {} })).id, position: 1 };
  }

  private async reconcileBadges(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`isms:concern-badges:${userId}`}))`;
    const evaluations = await tx.concernEvaluation.findMany({
      where: {
        reporterId: userId,
        status: { in: ["provisional", "final"] },
        ...currentWhere,
        legitimacy: { in: ["confirmed", "plausible", "confirmed_duplicate"] },
      },
      select: {
        id: true,
        legitimacy: true,
        severity: true,
        duplicatePosition: true,
        createdAt: true,
      },
    });
    const desired = concernBadgeOccurrences(
      evaluations.flatMap((item) =>
        item.legitimacy && item.severity && item.duplicatePosition
          ? [
              {
                id: item.id,
                legitimacy: item.legitimacy,
                severity: item.severity,
                position: item.duplicatePosition,
                createdAt: item.createdAt,
              },
            ]
          : [],
      ),
    );
    const desiredKeys = new Set(
      desired.map((occurrence) => badgeOccurrenceKey(occurrence.badgeKey, occurrence.evaluationId)),
    );
    const events = await tx.concernBadgeEvent.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const active = new Map<string, { badgeKey: DbBadgeKey; evaluationId: string }>();
    for (const event of events) {
      const key = badgeOccurrenceKey(event.badgeKey, event.evaluationId);
      if (event.kind === "awarded") {
        active.set(key, { badgeKey: event.badgeKey, evaluationId: event.evaluationId });
      } else active.delete(key);
    }
    const rows = [
      ...desired
        .filter(
          (occurrence) =>
            !active.has(badgeOccurrenceKey(occurrence.badgeKey, occurrence.evaluationId)),
        )
        .map(({ badgeKey, evaluationId }) => ({
          userId,
          badgeKey,
          kind: "awarded" as const,
          evaluationId,
        })),
      ...[...active.entries()]
        .filter(([key]) => !desiredKeys.has(key))
        .map(([, occurrence]) => ({
          userId,
          ...occurrence,
          kind: "revoked" as const,
        })),
    ];
    if (rows.length > 0) await tx.concernBadgeEvent.createMany({ data: rows });
  }

  /** Keeps current group positions deterministic after a CISO merge or split. */
  private async rebalanceGroup(
    tx: Tx,
    groupId: string,
    actorUserId: string,
  ): Promise<{ reporterId: string; evaluationId: string }[]> {
    const members = await tx.concernEvaluation.findMany({
      where: { duplicateGroupId: groupId, ...currentWhere },
      orderBy: [{ risk: { createdAt: "asc" } }, { riskId: "asc" }],
    });
    const changed: { reporterId: string; evaluationId: string }[] = [];
    for (const [index, member] of members.entries()) {
      if (!member.legitimacy || !member.severity) continue;
      const position = index + 1;
      const score = scoreConcern({
        legitimacy: member.legitimacy,
        severity: member.severity,
        position,
      });
      if (member.duplicatePosition === position && member.totalPoints === score.total) continue;
      await tx.concernEvaluation.update({
        where: { id: member.id },
        data: {
          duplicatePosition: position,
          legitimacyPoints: score.legitimacyPoints,
          severityPoints: score.severityPoints,
          positionPoints: score.positionPoints,
          totalPoints: score.total,
        },
      });
      await tx.concernRewardEntry.create({
        data: {
          evaluationId: member.id,
          userId: member.reporterId,
          kind: "adjustment",
          points: score.total - member.totalPoints,
          legitimacyPoints: score.legitimacyPoints - member.legitimacyPoints,
          severityPoints: score.severityPoints - member.severityPoints,
          positionPoints: score.positionPoints - member.positionPoints,
          note: "Duplicate group order recalculated",
          createdById: actorUserId,
        },
      });
      changed.push({ reporterId: member.reporterId, evaluationId: member.id });
    }
    return changed;
  }
}
