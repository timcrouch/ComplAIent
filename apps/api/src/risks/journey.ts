import type { ApprovalReadinessDto, PersonRef, RiskJourneyDto } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import {
  DomainError,
  RISK_STATES,
  type RiskState,
  type StateChange,
  isoDateUtc,
  riskJourney,
} from "@isms/domain";
import type { RiskRow } from "./mappers.js";

type Db = Prisma.TransactionClient;

const isRiskState = (v: unknown): v is RiskState => RISK_STATES.some((s) => s === v);

/**
 * The journey of a risk, derived only from its records: the state changes in its version
 * history (version 1, the report, and every version that changed `state`), its approvals
 * (the returns of the current cycle), and the approval readiness while it waits for an approver.
 */
export async function buildJourney(
  db: Db,
  row: RiskRow,
  approval: { approval: ApprovalReadinessDto; eligibleApprovers: PersonRef[] } | null,
): Promise<RiskJourneyDto> {
  const versions = await db.riskVersion.findMany({
    where: { riskId: row.id, OR: [{ version: 1 }, { changedFields: { has: "state" } }] },
    select: {
      snapshot: true,
      createdAt: true,
      changedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { version: "asc" },
  });
  const people = new Map<string, PersonRef>();
  const changes: StateChange[] = versions.map((v) => {
    people.set(v.changedBy.id, v.changedBy);
    const state = (v.snapshot as { state?: unknown }).state;
    if (!isRiskState(state))
      throw new DomainError(
        "INTERNAL",
        `Risk ${row.id} has an unknown state in its version history`,
      );
    return { state, at: v.createdAt, by: v.changedBy.id };
  });
  const { steps, since, returnCount, cycle, cycleStart } = riskJourney(changes);
  const person = (id: string | null): PersonRef | null =>
    id === null ? null : (people.get(id) ?? null);
  let waitingOn: RiskJourneyDto["waitingOn"];
  if (row.state === "approved" || row.state === "closed")
    waitingOn = {
      kind: "review",
      nextReviewDue: row.nextReviewDue === null ? null : isoDateUtc(row.nextReviewDue),
    };
  else if (row.state === "in_review" && approval !== null)
    waitingOn = {
      kind: "approver",
      rule: approval.approval.rule,
      reviewer: approval.approval.reviewer,
      eligibleApprovers: approval.eligibleApprovers,
      eligibleApproverCount: approval.approval.eligibleApproverCount,
      noEligibleApprover: approval.approval.noEligibleApprover,
    };
  else waitingOn = { kind: "owner", owner: row.owner };
  return {
    steps: steps.map((s) => ({
      key: s.key,
      status: s.status,
      at: s.at?.toISOString() ?? null,
      by: person(s.by),
    })),
    since: since.toISOString(),
    waitingOn,
    returnCount,
    cycle,
    returns: row.approvals
      .filter((a) => a.decision === "returned" && a.createdAt >= cycleStart)
      .map((a) => ({ at: a.createdAt.toISOString(), by: a.approver, comment: a.comment })),
  };
}
