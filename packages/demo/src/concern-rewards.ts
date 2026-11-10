import { scoreConcern, type ConcernLegitimacy, type ConcernSeverity } from "@isms/domain";
import type { Builder } from "./builder.js";
import type { RiskRow } from "./snapshot.js";

const CASES: readonly {
  legitimacy: ConcernLegitimacy;
  severity: ConcernSeverity;
  feedback: string;
}[] = [
  {
    legitimacy: "confirmed",
    severity: "critical",
    feedback: "This was a legitimate high-impact concern. Thank you for reporting it promptly.",
  },
  {
    legitimacy: "plausible",
    severity: "moderate",
    feedback: "This was a reasonable concern. The security team is gathering more evidence.",
  },
  {
    legitimacy: "confirmed",
    severity: "major",
    feedback: "This was a legitimate major concern and has been recognized.",
  },
  {
    legitimacy: "confirmed_duplicate",
    severity: "major",
    feedback: "Your independent report usefully corroborated an existing concern.",
  },
  {
    legitimacy: "not_confirmed",
    severity: "minor",
    feedback: "Thank you for speaking up. Review did not confirm a security concern this time.",
  },
  {
    legitimacy: "out_of_scope",
    severity: "informational",
    feedback: "Thank you for raising this. It was routed outside the security process.",
  },
];

/** Representative final outcomes for demo and training, without changing the risk workflow. */
export function writeConcernRewards(b: Builder, risks: readonly RiskRow[]): void {
  const selected = risks.slice(0, CASES.length);
  const groups = selected.map((risk) => ({ id: b.id(risk.createdAt), createdAt: risk.createdAt }));
  // The fourth case corroborates the third.
  if (groups[2] && groups[3]) groups[3] = groups[2];
  const uniqueGroups = new Map(groups.map((group) => [group.id, group]));
  b.rows.concernDuplicateGroups.push(...uniqueGroups.values());
  const activeBadges = new Set<string>();

  selected.forEach((risk, index) => {
    const sample = CASES[index];
    const group = groups[index];
    if (!sample || !group) return;
    const position = index === 3 ? 2 : 1;
    const score = scoreConcern({ ...sample, position });
    const evaluatedAt = new Date(risk.createdAt.getTime() + 5 * 60_000);
    const evaluationId = b.id(evaluatedAt);
    b.rows.concernEvaluations.push({
      id: evaluationId,
      riskId: risk.id,
      version: 1,
      reporterId: risk.reporterId,
      status: "final",
      source: "ciso",
      legitimacy: sample.legitimacy,
      severity: sample.severity,
      duplicateGroupId: group.id,
      duplicatePosition: position,
      legitimacyPoints: score.legitimacyPoints,
      severityPoints: score.severityPoints,
      positionPoints: score.positionPoints,
      totalPoints: score.total,
      feedback: sample.feedback,
      confidence: null,
      rationale: "Representative CISO judgment for demo and training.",
      uncertainty: null,
      failureReason: null,
      aiInteractionId: null,
      policyVersion: 1,
      requiresReview: false,
      evaluatedById: b.user("carl"),
      evaluatedAt,
      supersedesId: null,
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
    });
    b.rows.concernRewardEntries.push({
      id: b.id(evaluatedAt),
      evaluationId,
      userId: risk.reporterId,
      kind: "award",
      points: score.total,
      policyVersion: 1,
      legitimacyPoints: score.legitimacyPoints,
      severityPoints: score.severityPoints,
      positionPoints: score.positionPoints,
      note: "Demo final judgment",
      createdById: b.user("carl"),
      createdAt: evaluatedAt,
    });
    const badges = [
      ...(sample.legitimacy === "confirmed" && position === 1 ? ["first_signal" as const] : []),
      ...(sample.legitimacy === "confirmed" && ["major", "critical"].includes(sample.severity)
        ? ["high_impact" as const]
        : []),
      ...(sample.legitimacy === "confirmed_duplicate" ? ["corroborator" as const] : []),
    ];
    for (const badgeKey of badges) {
      const key = `${risk.reporterId}:${badgeKey}`;
      if (activeBadges.has(key)) continue;
      activeBadges.add(key);
      b.rows.concernBadgeEvents.push({
        id: b.id(evaluatedAt),
        userId: risk.reporterId,
        badgeKey,
        kind: "awarded",
        evaluationId,
        reason: "Demo badge criteria reached",
        createdAt: evaluatedAt,
      });
    }
  });
}
