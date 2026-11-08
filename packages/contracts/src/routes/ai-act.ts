import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text, textOrEmpty } from "../text.js";
import {
  AiActRoleSchema,
  AiClassificationAnswers,
  AiObligationKeySchema,
  AiObligationStatusSchema,
  AiSystemDetailDto,
  AiSystemListResponse,
  AiSystemStatusSchema,
} from "./ai-act-dtos.js";

/** A system's profile. The owner must be a user and the department a stored department (400). */
export const AiSystemInput = z
  .object({
    name: text(200, "name"),
    description: textOrEmpty(2000, "multiline"),
    /** The use the system is meant for (Art. 3(12)). */
    intendedPurpose: text(2000, "multiline"),
    role: AiActRoleSchema,
    supplier: text(200).nullable(),
    /** Free text, for example "vendor scoring engine v4". */
    model: text(200).nullable(),
    /** Recorded for context only: the duties of GPAI model providers (Art. 53-55) are out of scope. */
    usesGeneralPurposeModel: z.boolean(),
    status: AiSystemStatusSchema,
    ownerId: z.uuid(),
    departmentId: z.uuid().nullable(),
  })
  .strict()
  .openapi("AiSystemInput");
export type AiSystemInput = z.infer<typeof AiSystemInput>;

/** Any profile fields; at least one. A role change re-reconciles the obligations. */
export const AiSystemUpdateInput = AiSystemInput.partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Give at least one field" })
  .openapi("AiSystemUpdateInput");
export type AiSystemUpdateInput = z.infer<typeof AiSystemUpdateInput>;

/** The answers to save; the server decides the class. */
export const ClassifyAiSystemInput = z
  .object({
    answers: AiClassificationAnswers,
    /** The draft's interaction when the answers started from an AI draft; null when answered by hand. */
    interactionId: z.uuid().nullable(),
  })
  .strict()
  .openapi("ClassifyAiSystemInput");
export type ClassifyAiSystemInput = z.infer<typeof ClassifyAiSystemInput>;

/** A status, a note, or both. The audit trail records that the note changed, never its text. */
export const UpdateAiObligationInput = z
  .object({
    status: AiObligationStatusSchema.optional(),
    note: textOrEmpty(2000, "multiline").optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.note !== undefined, {
    message: "Give a status or a note",
  })
  .openapi("UpdateAiObligationInput");
export type UpdateAiObligationInput = z.infer<typeof UpdateAiObligationInput>;

export const LinkAiSystemRiskInput = z
  .object({ riskId: z.uuid() })
  .strict()
  .openapi("LinkAiSystemRiskInput");
export type LinkAiSystemRiskInput = z.infer<typeof LinkAiSystemRiskInput>;

const rationale = z.string().max(500);

/** One short rationale per question, shown under it as an "AI suggestion". */
export const AiClassificationRationales = z
  .object({
    isAiSystem: rationale,
    prohibitedPractices: rationale,
    annexISafetyComponent: rationale,
    annexIIIAreas: rationale,
    profilesPeople: rationale,
    derogation: rationale,
    transparency: rationale,
  })
  .openapi("AiClassificationRationales");

/** Suggested answers to review; nothing is stored but the AiInteraction. */
export const AiClassificationDraftResponse = z
  .object({
    answers: AiClassificationAnswers,
    rationales: AiClassificationRationales,
    /** Pass it as `interactionId` when saving, so the classification records `ai_assisted`. */
    interactionId: z.string(),
  })
  .openapi("AiClassificationDraftResponse");
export type AiClassificationDraftResponse = z.infer<typeof AiClassificationDraftResponse>;

/** Suggested steps for one obligation; nothing is stored until a person saves the note. */
export const AiObligationGuidanceResponse = z
  .object({
    steps: z.array(z.string()).min(3).max(6),
    evidenceHint: z.string().nullable(),
    interactionId: z.string(),
  })
  .openapi("AiObligationGuidanceResponse");
export type AiObligationGuidanceResponse = z.infer<typeof AiObligationGuidanceResponse>;

const systemParams = z.object({ id: z.uuid() });
const obligationParams = z.object({ id: z.uuid(), key: AiObligationKeySchema });
const systemRiskParams = z.object({ id: z.uuid(), riskId: z.uuid() });

const MODULE = "eu_ai_act" as const;

/**
 * The EU AI Act module (#16). Every route answers 404 while the module is off. 404 also: no
 * such system, obligation row or visible risk. 409: `duplicateAiSystemName`,
 * `duplicateAiSystemRisk`, `aiUnavailable.<reason>`.
 */
export const aiActRoutes = {
  listSystems: defineRoute({
    method: "get",
    path: "/api/v1/ai-act/systems",
    summary: "The AI system register, by name",
    permission: "aiact.read",
    module: MODULE,
    responses: { 200: AiSystemListResponse },
  }),
  createSystem: defineRoute({
    method: "post",
    path: "/api/v1/ai-act/systems",
    summary: "Add an AI system to the register; it starts unclassified",
    permission: "aiact.manage",
    module: MODULE,
    request: { body: AiSystemInput },
    responses: { 201: AiSystemDetailDto, 400: ErrorResponse, 409: ErrorResponse },
  }),
  getSystem: defineRoute({
    method: "get",
    path: "/api/v1/ai-act/systems/{id}",
    summary: "One AI system with its classification, obligations and the linked risks you may see",
    permission: "aiact.read",
    module: MODULE,
    request: { params: systemParams },
    responses: { 200: AiSystemDetailDto, 404: ErrorResponse },
  }),
  updateSystem: defineRoute({
    method: "patch",
    path: "/api/v1/ai-act/systems/{id}",
    summary: "Change an AI system's profile; retiring is a status change, there is no delete",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: systemParams, body: AiSystemUpdateInput },
    responses: {
      200: AiSystemDetailDto,
      400: ErrorResponse,
      404: ErrorResponse,
      409: ErrorResponse,
    },
  }),
  classify: defineRoute({
    method: "put",
    path: "/api/v1/ai-act/systems/{id}/classification",
    summary:
      "Save the questionnaire answers; the server decides the class and reconciles the obligations",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: systemParams, body: ClassifyAiSystemInput },
    responses: { 200: AiSystemDetailDto, 400: ErrorResponse, 404: ErrorResponse },
  }),
  draftClassification: defineRoute({
    method: "post",
    path: "/api/v1/ai-act/systems/{id}/classification/draft",
    summary:
      "Ask the AI to suggest answers from the system's profile; nothing is saved; 409 aiUnavailable.<reason>",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: systemParams },
    responses: { 200: AiClassificationDraftResponse, 404: ErrorResponse, 409: ErrorResponse },
  }),
  updateObligation: defineRoute({
    method: "patch",
    path: "/api/v1/ai-act/systems/{id}/obligations/{key}",
    summary: "Set an obligation's status or note",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: obligationParams, body: UpdateAiObligationInput },
    responses: { 200: AiSystemDetailDto, 404: ErrorResponse },
  }),
  obligationGuidance: defineRoute({
    method: "post",
    path: "/api/v1/ai-act/systems/{id}/obligations/{key}/guidance",
    summary:
      "Ask the AI for practical steps towards an obligation; nothing is saved; 409 aiUnavailable.<reason>",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: obligationParams },
    responses: { 200: AiObligationGuidanceResponse, 404: ErrorResponse, 409: ErrorResponse },
  }),
  linkRisk: defineRoute({
    method: "post",
    path: "/api/v1/ai-act/systems/{id}/risks",
    summary: "Link a risk you may see to an AI system; needs risks.read too",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: systemParams, body: LinkAiSystemRiskInput },
    responses: { 201: AiSystemDetailDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  unlinkRisk: defineRoute({
    method: "delete",
    path: "/api/v1/ai-act/systems/{id}/risks/{riskId}",
    summary: "Unlink a risk you may see from an AI system; needs risks.read too",
    permission: "aiact.manage",
    module: MODULE,
    request: { params: systemRiskParams },
    responses: { 200: AiSystemDetailDto, 404: ErrorResponse },
  }),
};
