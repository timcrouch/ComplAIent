/** Fixed, installation-independent concern reward policy from issue #31. */
export const CONCERN_LEGITIMACY_POINTS = Object.freeze({
  confirmed: 100,
  plausible: 40,
  confirmed_duplicate: 100,
  not_confirmed: 0,
  out_of_scope: 0,
  abusive: 0,
} as const);

export type ConcernLegitimacy = keyof typeof CONCERN_LEGITIMACY_POINTS;

export const CONCERN_SEVERITY_POINTS = Object.freeze({
  informational: 0,
  minor: 10,
  moderate: 25,
  major: 50,
  critical: 100,
} as const);

export type ConcernSeverity = keyof typeof CONCERN_SEVERITY_POINTS;

/** The first five reporters of the same underlying concern receive an early-signal bonus. */
export const CONCERN_POSITION_POINTS = Object.freeze([50, 25, 15, 10, 5] as const);

export type ConcernScoreInput = {
  legitimacy: ConcernLegitimacy;
  severity: ConcernSeverity;
  /** One-based position in the duplicate group. Values above five receive no position points. */
  position: number;
};

export type ConcernScore = {
  legitimacyPoints: number;
  severityPoints: number;
  positionPoints: number;
  total: number;
};

export function scoreConcern(input: ConcernScoreInput): ConcernScore {
  if (!Number.isInteger(input.position) || input.position < 1) {
    throw new RangeError("Concern report position must be a positive integer");
  }
  const legitimacyPoints = CONCERN_LEGITIMACY_POINTS[input.legitimacy];
  const useful = ["confirmed", "plausible", "confirmed_duplicate"].includes(input.legitimacy);
  const severityPoints = useful ? CONCERN_SEVERITY_POINTS[input.severity] : 0;
  const positionPoints =
    input.legitimacy === "confirmed" || input.legitimacy === "confirmed_duplicate"
      ? (CONCERN_POSITION_POINTS[input.position - 1] ?? 0)
      : 0;
  return {
    legitimacyPoints,
    severityPoints,
    positionPoints,
    total: legitimacyPoints + severityPoints + positionPoints,
  };
}

/** Rank thresholds are deliberately attainable while still rewarding sustained participation. */
export const CONCERN_RANKS = Object.freeze([
  { key: "recruit", label: "Recruit", minimumPoints: 0 },
  { key: "defender", label: "Defender", minimumPoints: 250 },
  { key: "protector", label: "Protector", minimumPoints: 750 },
  { key: "guardian", label: "Guardian", minimumPoints: 1_500 },
  { key: "security_vanguard", label: "Security Vanguard", minimumPoints: 3_000 },
] as const);

export type ConcernRank = (typeof CONCERN_RANKS)[number];

export const CONCERN_BADGES = Object.freeze({
  first_signal: {
    title: "First Signal",
    description: "First reporter of a confirmed concern.",
    repeatable: true,
  },
  sharp_eye: {
    title: "Sharp Eye",
    description: "Reported five confirmed or plausible concerns.",
    repeatable: false,
  },
  early_warning: {
    title: "Early Warning",
    description: "First to report three separately confirmed concerns.",
    repeatable: false,
  },
  high_impact: {
    title: "High Impact",
    description: "Reported a confirmed major or critical concern.",
    repeatable: true,
  },
  consistent_guardian: {
    title: "Consistent Guardian",
    description: "Reported useful concerns in three different calendar months.",
    repeatable: false,
  },
  corroborator: {
    title: "Corroborator",
    description: "Added useful corroboration to an existing concern.",
    repeatable: true,
  },
} as const);

export type ConcernBadgeKey = keyof typeof CONCERN_BADGES;

export type ConcernBadgeFacts = ConcernScoreInput & {
  confirmedOrPlausibleCount: number;
  firstConfirmedGroupCount: number;
  activeMonthCount: number;
};

export function earnedConcernBadges(facts: ConcernBadgeFacts): ConcernBadgeKey[] {
  const badges: ConcernBadgeKey[] = [];
  const useful = ["confirmed", "plausible", "confirmed_duplicate"].includes(facts.legitimacy);
  if (facts.legitimacy === "confirmed" && facts.position === 1) badges.push("first_signal");
  if (facts.confirmedOrPlausibleCount >= 5) badges.push("sharp_eye");
  if (facts.firstConfirmedGroupCount >= 3) badges.push("early_warning");
  if (
    facts.legitimacy === "confirmed" &&
    (facts.severity === "major" || facts.severity === "critical")
  )
    badges.push("high_impact");
  if (useful && facts.activeMonthCount >= 3) badges.push("consistent_guardian");
  if (facts.legitimacy === "confirmed_duplicate") badges.push("corroborator");
  return badges;
}

export type ConcernBadgeEvaluation = {
  id: string;
  legitimacy: ConcernLegitimacy;
  severity: ConcernSeverity;
  position: number;
  createdAt: Date;
};

export type ConcernBadgeOccurrence = {
  badgeKey: ConcernBadgeKey;
  evaluationId: string;
};

/**
 * Active badge occurrences derived from current useful evaluations. Repeatable badges retain
 * one occurrence per qualifying evaluation; threshold badges retain one deterministic trigger.
 */
export function concernBadgeOccurrences(
  evaluations: readonly ConcernBadgeEvaluation[],
): ConcernBadgeOccurrence[] {
  const ordered = [...evaluations].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
  const occurrences: ConcernBadgeOccurrence[] = [];
  const add = (badgeKey: ConcernBadgeKey, evaluationId: string) => {
    occurrences.push({ badgeKey, evaluationId });
  };

  for (const evaluation of ordered) {
    if (evaluation.legitimacy === "confirmed" && evaluation.position === 1) {
      add("first_signal", evaluation.id);
    }
    if (
      evaluation.legitimacy === "confirmed" &&
      (evaluation.severity === "major" || evaluation.severity === "critical")
    ) {
      add("high_impact", evaluation.id);
    }
    if (evaluation.legitimacy === "confirmed_duplicate") {
      add("corroborator", evaluation.id);
    }
  }

  if (ordered[4]) add("sharp_eye", ordered[4].id);
  const firstSignals = ordered.filter(
    (evaluation) => evaluation.legitimacy === "confirmed" && evaluation.position === 1,
  );
  if (firstSignals[2]) add("early_warning", firstSignals[2].id);

  const seenMonths = new Set<string>();
  for (const evaluation of ordered) {
    const month = evaluation.createdAt.toISOString().slice(0, 7);
    seenMonths.add(month);
    if (seenMonths.size === 3) {
      add("consistent_guardian", evaluation.id);
      break;
    }
  }
  return occurrences;
}

export function concernRank(points: number): ConcernRank {
  if (!Number.isFinite(points)) throw new RangeError("Concern reward points must be finite");
  const safePoints = Math.max(0, Math.floor(points));
  return (
    [...CONCERN_RANKS].reverse().find((rank) => safePoints >= rank.minimumPoints) ??
    CONCERN_RANKS[0]
  );
}
