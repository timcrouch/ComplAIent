"use server";

import {
  aiActRoutes,
  AiObligationKeySchema,
  AiSystemInput,
  AiSystemUpdateInput,
  ClassifyAiSystemInput,
  LinkAiSystemRiskInput,
  UpdateAiObligationInput,
  type AiClassificationDraftResponse,
  type AiObligationGuidanceResponse,
  type AiSystemDetailDto,
} from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const AI_ACT = "/ai-act";
const Uuid = z.uuid();

/** An id that is not a UUID names nothing the viewer can see. */
const notFound: CallResult<never> = { ok: false, kind: "not-found", details: [] };

const systemPage = (id: string) => ({ returnTo: `${AI_ACT}/systems/${id}` });

/** Every change refreshes the overview (counts, the register) and the system's own pages. */
const changed = <T>(result: CallResult<T>) => revalidated(result, AI_ACT);

/** Adds a system to the register; it starts unclassified. 409 `duplicateAiSystemName`. */
export async function createAiSystem(
  input: z.input<typeof AiSystemInput>,
): Promise<CallResult<AiSystemDetailDto>> {
  const body = AiSystemInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  return changed(
    await callApi(
      aiActRoutes.createSystem,
      { body: body.data },
      { returnTo: `${AI_ACT}/systems/new` },
    ),
  );
}

/** Changes a system's profile; a role change re-reconciles its obligations. */
export async function updateAiSystem(
  id: string,
  input: z.input<typeof AiSystemUpdateInput>,
): Promise<CallResult<AiSystemDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const body = AiSystemUpdateInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  return changed(
    await callApi(
      aiActRoutes.updateSystem,
      { params: { id }, body: body.data },
      { returnTo: `${AI_ACT}/systems/${id}/edit` },
    ),
  );
}

/**
 * Saves the questionnaire answers; the server decides the class. Pass the draft's
 * `interactionId` when the answers started from an AI draft (recorded as ai_assisted).
 */
export async function classifyAiSystem(
  id: string,
  input: z.input<typeof ClassifyAiSystemInput>,
): Promise<CallResult<AiSystemDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const body = ClassifyAiSystemInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  return changed(
    await callApi(
      aiActRoutes.classify,
      { params: { id }, body: body.data },
      { returnTo: `${AI_ACT}/systems/${id}/classify` },
    ),
  );
}

/** Asks the AI to suggest answers from the profile; nothing is saved. 409 `aiUnavailable.<reason>`. */
export async function draftAiClassification(
  id: string,
): Promise<CallResult<AiClassificationDraftResponse>> {
  if (!Uuid.safeParse(id).success) return notFound;
  return callApi(
    aiActRoutes.draftClassification,
    { params: { id } },
    { returnTo: `${AI_ACT}/systems/${id}/classify` },
  );
}

/** Sets an obligation's status, note, or both. */
export async function updateAiObligation(
  id: string,
  key: string,
  input: z.input<typeof UpdateAiObligationInput>,
): Promise<CallResult<AiSystemDetailDto>> {
  const parsedKey = AiObligationKeySchema.safeParse(key);
  if (!Uuid.safeParse(id).success || !parsedKey.success) return notFound;
  const body = UpdateAiObligationInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  return changed(
    await callApi(
      aiActRoutes.updateObligation,
      { params: { id, key: parsedKey.data }, body: body.data },
      systemPage(id),
    ),
  );
}

/** Asks the AI for practical steps towards one obligation; nothing is saved. */
export async function suggestAiObligationSteps(
  id: string,
  key: string,
): Promise<CallResult<AiObligationGuidanceResponse>> {
  const parsedKey = AiObligationKeySchema.safeParse(key);
  if (!Uuid.safeParse(id).success || !parsedKey.success) return notFound;
  return callApi(
    aiActRoutes.obligationGuidance,
    { params: { id, key: parsedKey.data } },
    systemPage(id),
  );
}

/** Links a risk the viewer may see. 409 `duplicateAiSystemRisk`. */
export async function linkAiSystemRisk(
  id: string,
  riskId: string,
): Promise<CallResult<AiSystemDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const body = LinkAiSystemRiskInput.safeParse({ riskId });
  if (!body.success) return invalid(body.error);
  return changed(
    await callApi(aiActRoutes.linkRisk, { params: { id }, body: body.data }, systemPage(id)),
  );
}

/** Unlinks a risk the viewer may see. */
export async function unlinkAiSystemRisk(
  id: string,
  riskId: string,
): Promise<CallResult<AiSystemDetailDto>> {
  if (!Uuid.safeParse(id).success || !Uuid.safeParse(riskId).success) return notFound;
  return changed(await callApi(aiActRoutes.unlinkRisk, { params: { id, riskId } }, systemPage(id)));
}
