import type { CompletionRequest } from "../provider.js";

export const MOCK_SUGGESTION_REASON = "Matches the scenario described.";
/** Not a library code: the caller must discard it (P3-R11). */
export const MOCK_UNKNOWN_CODE = "ZZZ-99";

/**
 * Mock reply for control suggestions: the first three candidates listed in the system prompt
 * (lines `- CODE: title`, see buildControlSuggestionPrompt), plus one unknown code.
 */
export function controlSuggestionReply(request: CompletionRequest): string {
  const codes = [...request.system.matchAll(/^- ([A-Z0-9-]{1,10}): /gm)]
    .map((m) => m[1])
    .filter((code): code is string => code !== undefined)
    .slice(0, 3);
  return JSON.stringify({
    suggestions: [...codes, MOCK_UNKNOWN_CODE].map((code) => ({
      code,
      reason: MOCK_SUGGESTION_REASON,
    })),
  });
}
