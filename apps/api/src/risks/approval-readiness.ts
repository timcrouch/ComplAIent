import type { ApprovalReadinessDto, PersonRef, RoleAssignmentDto } from "@isms/contracts";
import type { Prisma, Role } from "@isms/database";
import {
  type ApprovalRefusal,
  type ApprovalRule,
  TREATMENTS,
  type Treatment,
  approvalRefusal,
  approvalRule,
} from "@isms/domain";
import { type PolicyService, ROLE_PERMISSIONS, permissionsOfRole } from "../authorization/index.js";
import { type Actor, toRoleAssignmentDto } from "../identity/index.js";
import { LEVELS, type RiskRow, riskScope, toDecisions } from "./mappers.js";

type Db = Prisma.TransactionClient;

/** The roles that carry `risks.approve`, read from ROLE_PERMISSIONS, never listed twice. */
const APPROVER_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
  permissionsOfRole(role).includes("risks.approve"),
);

/** What the separation-of-duties rules (P3-R4) read from a risk. */
export type SodRisk = {
  likelihood: number | null;
  impact: number | null;
  treatment: Treatment | null;
  reporterId: string;
  reviewerId: string | null;
  siteId: string | null;
  departmentId: string | null;
};

/**
 * The approval rule of the risk at the current appetite. A risk in review is always assessed;
 * a returned risk being edited may not be, and then gets the strict rule.
 */
export function ruleOf(r: SodRisk, appetiteThreshold: number): ApprovalRule {
  if (r.likelihood === null || r.impact === null || r.treatment === null)
    return "independentApprover";
  return approvalRule({
    likelihood: r.likelihood,
    impact: r.impact,
    treatment: r.treatment,
    appetiteThreshold,
  });
}

/** `approvalRefusal` for one user and their current assignments. */
function refusalOf(
  policy: PolicyService,
  userId: string,
  roles: readonly RoleAssignmentDto[],
  r: SodRisk,
  rule: ApprovalRule,
): ApprovalRefusal | null {
  return approvalRefusal({
    actorId: userId,
    reporterId: r.reporterId,
    // A risk never submitted has no reviewer; the empty id matches no user.
    reviewerId: r.reviewerId ?? "",
    actorHoldsApprove: policy.grants(roles, "risks.approve", riskScope(r)),
    actorHoldsReview: policy.grants(roles, "risks.review", riskScope(r)),
    rule,
  });
}

/** Why the actor may not approve the risk now, or null when they may. */
export function approvalRefusalFor(
  policy: PolicyService,
  actor: Actor,
  r: SodRisk,
  appetiteThreshold: number,
): ApprovalRefusal | null {
  return refusalOf(policy, actor.userId, actor.roles, r, ruleOf(r, appetiteThreshold));
}

/** Returning is open to the reviewer (to withdraw it) and to anyone who could approve it. */
export function mayReturn(
  policy: PolicyService,
  actor: Actor,
  r: SodRisk,
  appetiteThreshold: number,
): boolean {
  return (
    r.reviewerId === actor.userId ||
    approvalRefusalFor(policy, actor, r, appetiteThreshold) === null
  );
}

/** At most this many eligible approvers are named. */
export const NAMED_APPROVERS = 5;

/**
 * Who `approvalRefusal` lets approve the risk now: holders of `risks.approve` at a scope
 * matching it, less the reporter and the reviewer, plus the reviewer when the rule lets the
 * reviewer approve (holding `risks.review` there is enough, spec §8.3) and the reviewer is
 * not the reporter. Assignments are read from the database, so revoked roles do not count.
 * `count` is everyone eligible; `approvers` names up to five, ordered by display name, and is
 * looked up only when `withNames` is set.
 */
export async function eligibleApprovers(
  db: Db,
  policy: PolicyService,
  r: SodRisk,
  appetiteThreshold: number,
  withNames = true,
): Promise<{ count: number; approvers: PersonRef[] }> {
  const units: Prisma.RoleAssignmentWhereInput[] = [{ scopeType: "ORGANISATION" }];
  if (r.siteId) units.push({ scopeType: "SITE", siteId: r.siteId });
  if (r.departmentId) units.push({ scopeType: "DEPARTMENT", departmentId: r.departmentId });
  // Approvers, and every assignment of the reviewer (who may approve without risks.approve).
  const holders: Prisma.RoleAssignmentWhereInput[] = [{ role: { in: APPROVER_ROLES } }];
  if (r.reviewerId) holders.push({ userId: r.reviewerId });
  const assignments = await db.roleAssignment.findMany({
    where: { AND: [{ OR: holders }, { OR: units }] },
    select: { userId: true, role: true, scopeType: true, siteId: true, departmentId: true },
  });
  const byUser = new Map<string, RoleAssignmentDto[]>();
  for (const a of assignments)
    byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), toRoleAssignmentDto(a)]);
  const rule = ruleOf(r, appetiteThreshold);
  const eligible: string[] = [];
  for (const [userId, roles] of byUser)
    if (refusalOf(policy, userId, roles, r, rule) === null) eligible.push(userId);
  const approvers =
    eligible.length === 0 || !withNames
      ? []
      : await db.user.findMany({
          where: { id: { in: eligible } },
          select: { id: true, displayName: true },
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          take: NAMED_APPROVERS,
        });
  return { count: eligible.length, approvers };
}

/**
 * The approval section of a risk's detail, and the approvers it names; null until first submitted.
 * Names go only to actors holding `risks.review` or `risks.approve` at the risk's scope (P5-R4);
 * everyone else still gets the count.
 */
export async function approvalReadiness(
  db: Db,
  policy: PolicyService,
  actor: Actor,
  row: RiskRow,
  appetiteThreshold: number,
): Promise<{ approval: ApprovalReadinessDto; eligibleApprovers: PersonRef[] } | null> {
  if (row.state === "proposed" || row.reviewer === null) return null;
  const scope = riskScope(row);
  const mayNameApprovers =
    policy.can(actor, "risks.review", scope) || policy.can(actor, "risks.approve", scope);
  const { count, approvers } = await eligibleApprovers(
    db,
    policy,
    row,
    appetiteThreshold,
    mayNameApprovers,
  );
  return {
    approval: {
      rule: ruleOf(row, appetiteThreshold),
      reviewer: row.reviewer,
      eligibleApproverCount: count,
      noEligibleApprover: count === 0,
      viewerRefusal: approvalRefusalFor(policy, actor, row, appetiteThreshold),
      decisions: toDecisions(row),
    },
    eligibleApprovers: approvers,
  };
}

/** The `Risk` filter for the actor's units under one permission; null when they have none. */
function unitsWhere(
  policy: PolicyService,
  actor: Actor,
  permission: "risks.approve" | "risks.review",
): Prisma.RiskWhereInput | null {
  const scope = policy.accessScope(actor, permission);
  if (scope.kind === "none") return null;
  if (scope.kind === "organisation") return {};
  return {
    OR: [{ siteId: { in: scope.siteIds } }, { departmentId: { in: scope.departmentIds } }],
  };
}

/**
 * `awaitingMyApproval`: risks in review for which `approvalRefusal` is null for the actor.
 * The database cannot call the domain rule, so the assessments under which the reviewer may
 * approve are listed with `approvalRule` itself; the two cannot disagree. Two branches: risks
 * someone else reviewed, in the actor's `risks.approve` units; and risks the actor reviewed
 * that the reviewer may approve, in their `risks.review` or `risks.approve` units. Null when
 * the actor holds neither permission anywhere.
 */
export function awaitingApprovalWhere(
  policy: PolicyService,
  actor: Actor,
  appetiteThreshold: number,
): Prisma.RiskWhereInput | null {
  const approveUnits = unitsWhere(policy, actor, "risks.approve");
  const reviewUnits = unitsWhere(policy, actor, "risks.review");
  if (approveUnits === null && reviewUnits === null) return null;
  const reviewerMayApprove: Prisma.RiskWhereInput[] = [];
  for (const likelihood of LEVELS)
    for (const impact of LEVELS)
      for (const treatment of TREATMENTS)
        if (
          approvalRule({ likelihood, impact, treatment, appetiteThreshold }) ===
          "reviewerMayApprove"
        )
          reviewerMayApprove.push({ likelihood, impact, treatment });
  const branches: Prisma.RiskWhereInput[] = [];
  if (approveUnits !== null)
    branches.push({ AND: [{ reviewerId: { not: actor.userId } }, approveUnits] });
  const ownUnits = [approveUnits, reviewUnits].filter((u) => u !== null);
  if (reviewerMayApprove.length > 0)
    branches.push({
      AND: [{ reviewerId: actor.userId }, { OR: reviewerMayApprove }, { OR: ownUnits }],
    });
  return {
    AND: [
      { state: "in_review" },
      { reporterId: { not: actor.userId } },
      branches.length > 0 ? { OR: branches } : { id: { in: [] } },
    ],
  };
}
