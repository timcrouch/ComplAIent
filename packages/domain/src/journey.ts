import { DomainError } from "./errors.js";
import type { RiskState } from "./risk.js";

/** The five steps of a risk's journey, in order. */
export const JOURNEY_STEPS = [
  "reported",
  "under_review",
  "awaiting_approval",
  "approved",
  "closed",
] as const;
export type JourneyStepKey = (typeof JOURNEY_STEPS)[number];
/** One recorded state transition of a risk: the new state, when, and by whom. */
export type StateChange = { state: RiskState; at: Date; by: string };
/** One step of the journey as shown to the user, with its status and who/when. */
export type JourneyStep = {
  key: JourneyStepKey;
  status: "done" | "current" | "upcoming";
  /** done: when it was completed; current: when it was entered; upcoming: null. */
  at: Date | null;
  /** The user who completed (done) or entered (current) it. */
  by: string | null;
};

function lastTo(changes: readonly StateChange[], state: RiskState): StateChange | undefined {
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i]?.state === state) return changes[i];
  }
  return undefined;
}

/** Index where the current cycle starts: the last change into proposed after approved/closed, else 0. */
function cycleStart(changes: readonly StateChange[]): number {
  for (let i = changes.length - 1; i > 0; i--) {
    const prev = changes[i - 1]?.state;
    if (changes[i]?.state === "proposed" && (prev === "approved" || prev === "closed")) return i;
  }
  return 0;
}

/**
 * `changes` are oldest first; the first entry is the report. Only the current cycle counts:
 * it starts at the report, or at the latest reassess (a change into proposed from approved/closed).
 */
export function riskJourney(allChanges: readonly StateChange[]): {
  steps: JourneyStep[];
  since: Date;
  returnCount: number;
  cycle: "first" | "reassessed";
  /** When the current cycle began: the report, or the latest reassess. */
  cycleStart: Date;
} {
  const start = cycleStart(allChanges);
  const changes = allChanges.slice(start);
  const first = changes[0];
  const last = changes[changes.length - 1];
  if (!first || !last) {
    throw new DomainError("INTERNAL", "A risk has no state history.");
  }
  const step = (
    key: JourneyStepKey,
    status: JourneyStep["status"],
    c?: StateChange,
  ): JourneyStep => ({
    key,
    status,
    at: status === "upcoming" ? null : (c?.at ?? null),
    by: status === "upcoming" ? null : (c?.by ?? null),
  });
  const inReview = lastTo(changes, "in_review") ?? last;
  let steps: JourneyStep[];
  if (last.state === "closed") {
    const approved = lastTo(changes, "approved") ?? last;
    steps = [
      step("reported", "done", first),
      step("under_review", "done", inReview),
      step("awaiting_approval", "done", approved),
      step("approved", "done", approved),
      step("closed", "current", last),
    ];
  } else if (last.state === "approved") {
    steps = [
      step("reported", "done", first),
      step("under_review", "done", inReview),
      step("awaiting_approval", "done", last),
      step("approved", "current", last),
      step("closed", "upcoming"),
    ];
  } else if (last.state === "in_review") {
    steps = [
      step("reported", "done", first),
      step("under_review", "done", last),
      step("awaiting_approval", "current", last),
      step("approved", "upcoming"),
      step("closed", "upcoming"),
    ];
  } else {
    steps = [
      step("reported", "done", first),
      step("under_review", "current", last),
      step("awaiting_approval", "upcoming"),
      step("approved", "upcoming"),
      step("closed", "upcoming"),
    ];
  }
  return {
    steps,
    since: last.at,
    returnCount: changes.filter((c) => c.state === "returned").length,
    cycle: start > 0 ? "reassessed" : "first",
    cycleStart: first.at,
  };
}
