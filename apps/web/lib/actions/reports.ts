"use server";

import {
  ApproveNarrativeInput,
  type BoardNarrativeDto,
  type NarrativeDraftResponse,
  reportRoutes,
  SetApplicabilityInput,
  type SoaRowDto,
} from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const SOA = "/reports/soa";

/** Decides whether a requirement applies, with the reason. 400 `details` name the field at fault. */
export async function setApplicability(
  requirementId: string,
  input: z.input<typeof SetApplicabilityInput>,
): Promise<CallResult<SoaRowDto>> {
  const id = z.uuid().safeParse(requirementId);
  if (!id.success) return invalid(id.error);
  const body = SetApplicabilityInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  const result = await callApi(
    reportRoutes.setApplicability,
    { params: { requirementId: id.data }, body: body.data },
    { returnTo: SOA },
  );
  return revalidated(result, "/reports");
}

const BOARD = "/reports/board";
const PERIOD = z.string().min(1).max(20);

/**
 * Asks the AI for a draft of the period's narrative; nothing is stored. 409 `aiUnavailable.<reason>`
 * or `narrativeUnverifiable` when it cannot be used.
 */
export async function draftNarrative(period: string): Promise<CallResult<NarrativeDraftResponse>> {
  const parsed = PERIOD.safeParse(period);
  if (!parsed.success) return invalid(parsed.error);
  return callApi(
    reportRoutes.narrativeDraft,
    { body: { period: parsed.data } },
    { returnTo: BOARD },
  );
}

/** Approves the period's narrative, typed or from a draft. 400 at `text` when it has figures not in the records. */
export async function approveNarrative(
  input: z.input<typeof ApproveNarrativeInput>,
): Promise<CallResult<BoardNarrativeDto>> {
  const body = ApproveNarrativeInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  const result = await callApi(
    reportRoutes.approveNarrative,
    { body: body.data },
    { returnTo: BOARD },
  );
  return revalidated(result, "/reports");
}
