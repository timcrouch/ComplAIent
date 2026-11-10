"use server";

import {
  concernRewardRoutes,
  ConcernReplyInput,
  concernRoutes,
  ReportRiskInput,
  riskRoutes,
  StartConcernInput,
  type ConversationDto,
  type ConcernEvaluationDto,
  type RiskDetailDto,
  type SecurityContributionDto,
} from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const RETURN_TO = { returnTo: "/report" };
const CONCERNS = "/concerns";
const ConversationId = z.uuid();
const RiskId = z.uuid();

export type ConcernRewardCheck = {
  evaluation: ConcernEvaluationDto;
  contribution: SecurityContributionDto;
};

/** A conversation id that is not a UUID names nothing the reporter owns. */
const notFound: CallResult<never> = {
  ok: false,
  kind: "not-found",
  details: [],
};

/**
 * Starts a conversation with the reporter's first words; the AI asks its first question.
 * A failed first turn is 409 `aiUnavailable.<reason>` with a `conversationId` detail: the
 * conversation is kept, so the form can report through it.
 */
export async function startConcern(text: string): Promise<CallResult<ConversationDto>> {
  const parsed = StartConcernInput.safeParse({ text });
  if (!parsed.success) return invalid(parsed.error);
  return callApi(concernRoutes.start, { body: parsed.data }, RETURN_TO);
}

/** Answers the AI's question; `notSure` keeps the question as something to confirm. */
export async function replyToConcern(
  id: string,
  text: string,
  notSure: boolean,
): Promise<CallResult<ConversationDto>> {
  if (!ConversationId.safeParse(id).success) return notFound;
  const parsed = ConcernReplyInput.safeParse({ text, notSure });
  if (!parsed.success) return invalid(parsed.error);
  return callApi(concernRoutes.reply, { params: { id }, body: parsed.data }, RETURN_TO);
}

/** The reporter's own conversation, as stored (after another turn wrote first). */
export async function getConcern(id: string): Promise<CallResult<ConversationDto>> {
  if (!ConversationId.safeParse(id).success) return notFound;
  return callApi(concernRoutes.get, { params: { id } }, RETURN_TO);
}

/**
 * Reports the checked answers through the conversation. The input is strict: an AI estimate is
 * refused here, as the API takes it only from the draft it stored (P3-R5).
 */
export async function submitConcern(
  id: string,
  input: ReportRiskInput,
): Promise<CallResult<RiskDetailDto>> {
  if (!ConversationId.safeParse(id).success) return notFound;
  const parsed = ReportRiskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(concernRoutes.submit, { params: { id }, body: parsed.data }, RETURN_TO),
    CONCERNS,
  );
}

/** Reports a concern with the form alone (AI off, or the reporter chose the form). */
export async function reportRisk(input: ReportRiskInput): Promise<CallResult<RiskDetailDto>> {
  const parsed = ReportRiskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(await callApi(riskRoutes.report, { body: parsed.data }, RETURN_TO), CONCERNS);
}

/**
 * Reads the submitted concern's evaluation and the reporter's resulting contribution together.
 * The API remains authoritative for ownership: another reporter's risk is indistinguishable from
 * a missing one. This is intentionally read-only and is polled briefly after submission.
 */
export async function getConcernReward(riskId: string): Promise<CallResult<ConcernRewardCheck>> {
  const id = RiskId.safeParse(riskId);
  if (!id.success) return notFound;
  const evaluation = await callApi(concernRewardRoutes.get, { params: { id: id.data } }, RETURN_TO);
  if (!evaluation.ok) return evaluation;
  const contribution = await callApi(concernRewardRoutes.contribution, {}, RETURN_TO);
  if (!contribution.ok) return contribution;
  return { ok: true, data: { evaluation: evaluation.data, contribution: contribution.data } };
}
