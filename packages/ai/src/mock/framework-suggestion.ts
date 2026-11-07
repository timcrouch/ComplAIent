import type { CompletionRequest } from "../provider.js";

export const MOCK_FRAMEWORK_REASONING = "Suggested from your answers — please check.";

const SUGGESTED = /gdpr|iso27001|nis2/;

/**
 * Mock reply for framework suggestions: every catalog key in the system prompt (lines
 * `- key: name (version)`, see buildFrameworkSuggestionPrompt) containing gdpr, iso27001 or nis2.
 */
export function frameworkSuggestionReply(request: CompletionRequest): string {
  const keys = [...request.system.matchAll(/^- ([a-z0-9][a-z0-9._-]{0,59}): /gm)]
    .map((m) => m[1])
    .filter((key): key is string => key !== undefined && SUGGESTED.test(key));
  return JSON.stringify({
    suggestions: keys.map((frameworkVersionKey) => ({
      frameworkVersionKey,
      reasoning: MOCK_FRAMEWORK_REASONING,
    })),
  });
}
