import {
  ConcernEvaluationOutput,
  buildConcernEvaluationPrompt,
  type AiGateway,
  type ConcernEvaluationText,
} from "@isms/ai";
import type { Prisma, PrismaClient } from "@isms/database";
import {
  concernBadgeOccurrences,
  scoreConcern,
  type ConcernBadgeKey,
  type ConcernLegitimacy,
  type ConcernSeverity,
} from "@isms/domain";
import type { JobPayload } from "@isms/jobs";

type Logger = {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
};

type Deps = { db: PrismaClient; gateway: AiGateway; logger: Logger };
type Tx = Prisma.TransactionClient;

const text = (risk: {
  id: string;
  title: string;
  scenario: string;
  threat: string;
  consequence: string;
  existingSafeguards: string;
}): ConcernEvaluationText => risk;

const occurrenceKey = (badgeKey: ConcernBadgeKey, evaluationId: string) =>
  `${badgeKey}:${evaluationId}`;

async function activeBadgeOccurrences(tx: Tx, userId: string): Promise<Set<string>> {
  const events = await tx.concernBadgeEvent.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { badgeKey: true, evaluationId: true, kind: true },
  });
  const active = new Set<string>();
  for (const event of events) {
    const key = occurrenceKey(event.badgeKey, event.evaluationId);
    if (event.kind === "awarded") active.add(key);
    else active.delete(key);
  }
  return active;
}

async function awardBadges(
  tx: Tx,
  evaluation: {
    id: string;
    reporterId: string;
    legitimacy: ConcernLegitimacy;
    severity: ConcernSeverity;
    duplicatePosition: number;
  },
): Promise<ConcernBadgeKey[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`isms:concern-badges:${evaluation.reporterId}`}))`;
  const useful = await tx.concernEvaluation.findMany({
    where: {
      reporterId: evaluation.reporterId,
      status: { in: ["provisional", "final"] },
      supersededBy: null,
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
    useful.flatMap((item) =>
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
  const active = await activeBadgeOccurrences(tx, evaluation.reporterId);
  const added = desired.filter(
    (occurrence) => !active.has(occurrenceKey(occurrence.badgeKey, occurrence.evaluationId)),
  );
  if (added.length > 0) {
    await tx.concernBadgeEvent.createMany({
      data: added.map(({ badgeKey, evaluationId }) => ({
        userId: evaluation.reporterId,
        badgeKey,
        kind: "awarded" as const,
        evaluationId,
        reason: "Badge criteria reached",
      })),
    });
  }
  return added.map((occurrence) => occurrence.badgeKey);
}

/** Background AI evaluation. Every exit leaves a usable CISO queue state. */
export async function evaluateConcern(
  { db, gateway, logger }: Deps,
  payload: JobPayload<"concern.evaluate">,
): Promise<void> {
  const stored = await db.concernEvaluation.findUnique({
    where: { id: payload.evaluationId },
    include: { risk: true, supersededBy: { select: { id: true } } },
  });
  if (!stored || stored.status !== "pending" || stored.supersededBy !== null) return;
  const organisation = await db.organisation.findFirst({
    where: { singleton: true },
    select: { concernRewardsEnabled: true },
  });
  if (organisation?.concernRewardsEnabled !== true) {
    await db.concernEvaluation.updateMany({
      where: { id: stored.id, status: "pending" },
      data: { status: "suspended" },
    });
    return;
  }

  const candidates = await db.concernEvaluation.findMany({
    where: {
      riskId: { not: stored.riskId },
      status: { in: ["provisional", "final"] },
      duplicateGroupId: { not: null },
      supersededBy: null,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { risk: true },
  });
  const prompt = buildConcernEvaluationPrompt(
    text(stored.risk),
    candidates.map((candidate) => text(candidate.risk)),
  );
  const result = await gateway.run("concern_evaluation", {
    ...prompt,
    schema: ConcernEvaluationOutput,
    schemaName: "concern_evaluation",
    maxTokens: 1200,
    timeoutMs: 20_000,
    actorUserId: null,
    object: { type: "ConcernEvaluation", id: stored.id },
  });
  if (!result.ok) {
    await db.concernEvaluation.updateMany({
      where: { id: stored.id, status: "pending" },
      data: { failureReason: result.reason },
    });
    logger.warn({ job: "concern.evaluate", reason: result.reason }, "concern needs human review");
    return;
  }

  const out = result.value;
  const applied = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "ConcernEvaluation" WHERE "id" = ${stored.id}::uuid FOR UPDATE`;
    const current = await tx.concernEvaluation.findUniqueOrThrow({ where: { id: stored.id } });
    const enabled = await tx.organisation.findFirst({
      where: { singleton: true },
      select: { concernRewardsEnabled: true },
    });
    if (enabled?.concernRewardsEnabled !== true) {
      await tx.concernEvaluation.update({
        where: { id: current.id },
        data: { status: "suspended" },
      });
      return null;
    }
    if (current.status !== "pending") return null;

    let groupId: string;
    let position: number;
    let legitimacy: ConcernLegitimacy = out.legitimacy;
    if (out.duplicateRiskId) {
      const duplicate = await tx.concernEvaluation.findFirst({
        where: {
          riskId: out.duplicateRiskId,
          duplicateGroupId: { not: null },
          status: { in: ["provisional", "final"] },
          supersededBy: null,
        },
        select: { duplicateGroupId: true },
      });
      if (duplicate?.duplicateGroupId) {
        groupId = duplicate.duplicateGroupId;
        position =
          (await tx.concernEvaluation.count({
            where: { duplicateGroupId: groupId, supersededBy: null },
          })) + 1;
      } else {
        groupId = (await tx.concernDuplicateGroup.create({ data: {} })).id;
        position = 1;
        legitimacy = "confirmed";
      }
    } else {
      groupId = (await tx.concernDuplicateGroup.create({ data: {} })).id;
      position = 1;
    }
    const score = scoreConcern({ legitimacy, severity: out.severity, position });
    const requiresReview =
      out.confidence < 0.75 ||
      out.duplicateRiskId !== null ||
      out.severity === "major" ||
      out.severity === "critical" ||
      legitimacy === "not_confirmed" ||
      legitimacy === "out_of_scope";
    const evaluation = await tx.concernEvaluation.update({
      where: { id: current.id },
      data: {
        status: "provisional",
        source: "ai",
        legitimacy,
        severity: out.severity,
        confidence: out.confidence,
        rationale: out.cisoRationale,
        uncertainty: out.uncertainty,
        feedback: out.reporterFeedback,
        aiInteractionId: result.interactionId,
        failureReason: null,
        duplicateGroupId: groupId,
        duplicatePosition: position,
        legitimacyPoints: score.legitimacyPoints,
        severityPoints: score.severityPoints,
        positionPoints: score.positionPoints,
        totalPoints: score.total,
        requiresReview,
        evaluatedAt: new Date(),
      },
    });
    await tx.concernRewardEntry.create({
      data: {
        evaluationId: evaluation.id,
        userId: evaluation.reporterId,
        kind: "award",
        points: score.total,
        legitimacyPoints: score.legitimacyPoints,
        severityPoints: score.severityPoints,
        positionPoints: score.positionPoints,
        note: "Provisional AI evaluation",
      },
    });
    const badges = await awardBadges(tx, {
      id: evaluation.id,
      reporterId: evaluation.reporterId,
      legitimacy,
      severity: out.severity,
      duplicatePosition: position,
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: null,
        action: "concern.evaluated_by_ai",
        objectType: "ConcernEvaluation",
        objectId: evaluation.id,
        afterRef: {
          legitimacy,
          severity: out.severity,
          confidence: out.confidence,
          points: score.total,
          badges,
          requiresReview,
        },
        requestId: `job:concern.evaluate:${evaluation.id}`,
      },
    });
    return { points: score.total, badges: badges.length };
  });
  if (applied) {
    await gateway.setOutcome(result.interactionId, "accepted").catch(() => undefined);
    logger.info({ job: "concern.evaluate", ...applied }, "concern evaluation ready");
  }
}
