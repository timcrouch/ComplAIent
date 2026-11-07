import type {
  ConcernAiStatusDto,
  ConcernMessageDto,
  ConcernTranscriptDto,
  ConversationDto,
} from "@isms/contracts";
import type { ConcernConversation, ConcernMessage } from "@isms/database";
import { readStoredDraft } from "./concern-draft.js";

type ConversationRow = ConcernConversation & { messages: ConcernMessage[] };

function toMessageDto(m: ConcernMessage): ConcernMessageDto {
  return { seq: m.seq, role: m.role, text: m.text, chips: m.chips, notSure: m.notSure };
}

/** The reporter's view: messages, the draft (the interaction id stays server-side) and AI status. */
export function toConversationDto(c: ConversationRow, ai: ConcernAiStatusDto): ConversationDto {
  return {
    id: c.id,
    status: c.status,
    messages: c.messages.map(toMessageDto),
    draft: readStoredDraft(c.draft)?.draft ?? null,
    questionCount: c.questionCount,
    ai,
  };
}

/** The read-only transcript of a reported concern. */
export function toTranscriptDto(c: ConversationRow): ConcernTranscriptDto {
  return { id: c.id, status: c.status, messages: c.messages.map(toMessageDto) };
}
