import { Inject, Injectable } from "@nestjs/common";
import {
  AiActClassificationOutput,
  AiActGuidanceOutput,
  type AiSystemProfileText,
  buildAiActClassificationPrompt,
  buildAiActGuidancePrompt,
} from "@isms/ai";
import {
  AiClassificationAnswers,
  type AiClassificationDraftResponse,
  type AiObligationGuidanceResponse,
} from "@isms/contracts";
import { type AiObligationKey, aiObligation } from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { notFound } from "./ai-system-reader.js";
import { aiUnavailable } from "./errors.js";

const MAX_TOKENS = 1500;
const TIMEOUT_MS = 60_000;

/** Exactly the fields a provider may see (spec §5a); nothing else is read for a prompt. */
const PROFILE_SELECT = {
  name: true,
  description: true,
  intendedPurpose: true,
  role: true,
  supplier: true,
  model: true,
  usesGeneralPurposeModel: true,
} as const;

/**
 * AI assistance for the AI Act module (#16 §5a). Never required and never deciding: it drafts
 * answers or suggests steps, and a person reviews and saves. Nothing is stored but the
 * AiInteraction. Not ready, or output that fails the contract: 409 aiUnavailable.<reason>, as
 * for the other purposes.
 */
@Injectable()
export class AiActAssistService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
  ) {}

  private async profile(id: string): Promise<AiSystemProfileText> {
    const row = await this.prisma.aiSystem.findUnique({ where: { id }, select: PROFILE_SELECT });
    if (!row) throw notFound();
    return row;
  }

  async draftClassification(actor: Actor, id: string): Promise<AiClassificationDraftResponse> {
    const profile = await this.profile(id);
    const readiness = await this.ai.readiness("ai_act_classification");
    if (!readiness.ready) throw aiUnavailable(readiness.reason);
    const result = await this.ai.run("ai_act_classification", {
      ...buildAiActClassificationPrompt(profile),
      schema: AiActClassificationOutput,
      schemaName: "ai_act_classification",
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      actorUserId: actor.userId,
      object: { type: "AiSystem", id },
    });
    if (!result.ok) throw aiUnavailable(result.reason);
    // The same schema the save uses: a draft that could not be saved is not offered.
    const answers = AiClassificationAnswers.safeParse(result.value.answers);
    if (!answers.success) {
      await this.ai.setOutcome(result.interactionId, "rejected");
      throw aiUnavailable("invalidOutput");
    }
    await this.ai.setOutcome(result.interactionId, "pending");
    return {
      answers: answers.data,
      rationales: result.value.rationales,
      interactionId: result.interactionId,
    };
  }

  /** 404 when the system has no row for the key (it is not classified yet). */
  async obligationGuidance(
    actor: Actor,
    id: string,
    key: AiObligationKey,
  ): Promise<AiObligationGuidanceResponse> {
    const profile = await this.profile(id);
    const row = await this.prisma.aiSystem.findUnique({
      where: { id },
      select: { riskClass: true, obligations: { where: { key }, select: { key: true } } },
    });
    if (!row || row.obligations.length === 0) throw notFound();
    const readiness = await this.ai.readiness("ai_act_obligation_guidance");
    if (!readiness.ready) throw aiUnavailable(readiness.reason);
    const { riskClass } = row;
    const entry = aiObligation(key);
    const result = await this.ai.run("ai_act_obligation_guidance", {
      ...buildAiActGuidancePrompt({
        profile,
        obligation: { key, article: entry.article },
        riskClass,
      }),
      schema: AiActGuidanceOutput,
      schemaName: "ai_act_obligation_guidance",
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      actorUserId: actor.userId,
      object: { type: "AiSystem", id },
    });
    if (!result.ok) throw aiUnavailable(result.reason);
    return {
      steps: result.value.steps,
      evidenceHint: result.value.evidenceHint,
      interactionId: result.interactionId,
    };
  }
}
