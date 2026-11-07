import type { CompletionRequest } from "../provider.js";
import { concernTurnReply } from "./concern-turn.js";
import { connectionTestReply } from "./connection-test.js";
import { controlSuggestionReply } from "./control-suggestion.js";
import { controlTestStepsReply } from "./control-test-steps.js";
import { frameworkSuggestionReply } from "./framework-suggestion.js";
import { postureSummaryReply } from "./posture-summary.js";

/**
 * Deterministic mock replies by `schemaName`. Each purpose keeps its reply in its own file in this
 * folder; later tasks register theirs here (control_suggestion: Task 7, concern_turn: Task 8,
 * framework_suggestion: Task 12).
 */
export const MOCK_REPLIES: Readonly<Record<string, (request: CompletionRequest) => string>> = {
  concern_turn: concernTurnReply,
  connection_test: connectionTestReply,
  control_suggestion: controlSuggestionReply,
  control_test_steps: controlTestStepsReply,
  framework_suggestion: frameworkSuggestionReply,
  posture_summary: postureSummaryReply,
};
