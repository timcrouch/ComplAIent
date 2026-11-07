import type { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { riskScope } from "./mappers.js";

const isAdministrator = (actor: Actor): boolean =>
  actor.roles.some((r) => r.role === "administrator" && r.scope.type === "organisation");

/**
 * Transcripts are restricted (PF5): only a risk with a conversation has one, and only its
 * reporter, an organisation administrator, or a holder of `ai.transcripts.read` at the risk's
 * scope who may also see the risk reads it. The one rule for the transcript route and for
 * `RiskDetailDto.can.readTranscript`.
 */
export function mayReadTranscript(
  policy: PolicyService,
  actor: Actor,
  t: {
    /** The conversation's reporter; null when the risk has no conversation. */
    conversationReporterId: string | null;
    siteId: string | null;
    departmentId: string | null;
    /** Whether the actor may see the risk (§10). */
    riskVisible: boolean;
  },
): boolean {
  if (t.conversationReporterId === null) return false;
  if (t.conversationReporterId === actor.userId || isAdministrator(actor)) return true;
  return t.riskVisible && policy.can(actor, "ai.transcripts.read", riskScope(t));
}
