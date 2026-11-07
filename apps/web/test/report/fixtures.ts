import type { ConcernDraftDto, ConcernMessageDto, ConversationDto } from "@isms/contracts";

export const CONVERSATION_ID = "5d7c1f0e-2a4b-4c3d-9e8f-0a1b2c3d4e5f";
export const RIGA = {
  id: "8e1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "Riga plant",
};
export const MUNICH = {
  id: "9f2a7c3b-4d5e-4f6a-9b0c-1d2e3f4a5b6c",
  name: "Munich office",
};
export const SITES = [RIGA, MUNICH];

const ai = { available: true, reason: null };

export function reporter(seq: number, text: string, notSure = false): ConcernMessageDto {
  return { seq, role: "reporter", text, chips: [], notSure };
}

export function assistant(seq: number, text: string, chips: string[] = []): ConcernMessageDto {
  return { seq, role: "assistant", text, chips, notSure: false };
}

export function conversation(
  messages: ConcernMessageDto[],
  overrides: Partial<ConversationDto> = {},
): ConversationDto {
  return {
    id: CONVERSATION_ID,
    status: "open",
    messages,
    draft: null,
    questionCount: messages.filter((m) => m.role === "assistant").length,
    ai,
    ...overrides,
  };
}

export function draft(overrides: Partial<ConcernDraftDto> = {}): ConcernDraftDto {
  return {
    title: "Laptops left in unlocked cars",
    scenario: "Laptops left in unlocked cars\nRiga plant\nA device\nNo",
    threat: "Laptops left in unlocked cars",
    consequence: "",
    existingSafeguards: "",
    assets: [{ name: "A device", type: "device" }],
    siteId: RIGA.id,
    departmentId: null,
    toConfirm: ["What could be affected?"],
    aiEstimate: {
      likelihood: 3,
      impact: 4,
      reasoning: "Estimated from the description.",
    },
    ...overrides,
  };
}

export const FIRST = "Laptops left in unlocked cars";
export const Q_SITE = assistant(2, "Which site is this about?", ["Riga plant", "Munich office"]);
export const Q_AFFECTED = assistant(4, "What could be affected?", [
  "Customer data",
  "A system or app",
]);

/** A RiskDetailDto-shaped result; the flow reads only the reference. */
export function reported(reference = "R-0001") {
  return {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    reference,
    title: FIRST,
    state: "proposed",
  };
}
