import type { CompletionRequest } from "../provider.js";

/** In a fact (a risk title), makes the mock posture summary use a number not in the facts. */
export const MOCK_BAD_NUMBER_MARKER = "[[mock:badnumber]]";
const BAD_NUMBER = "987654";

/**
 * Mock reply for the posture summary: reads the facts' lines (see buildPostureSummaryPrompt) and
 * uses only their figures, as digits.
 */
export function postureSummaryReply(request: CompletionRequest): string {
  const content = request.messages.map((m) => m.content).join("\n");
  const fact = (label: string) => new RegExp(`^${label}: (\\d+)$`, "m").exec(content)?.[1] ?? "0";
  const top = /^- (R-\d+): /m.exec(content)?.[1];
  const paragraphs = [
    `There are ${fact("Open risks")} open risks, and ${fact("Open risks above appetite")} of them are above the risk appetite.`,
    `In the period, ${fact("Risks reported in the period")} risks were reported, ${fact("Risk approvals in the period")} approvals were made and ${fact("Risks closed in the period")} risks were closed. ${fact("Overdue treatment actions")} treatment actions are overdue and ${fact("Risk reviews due")} reviews are due.`,
  ];
  if (top !== undefined) paragraphs.push(`The highest risk is ${top}.`);
  if (content.includes(MOCK_BAD_NUMBER_MARKER))
    paragraphs.push(`Losses could reach ${BAD_NUMBER} euros.`);
  return JSON.stringify({ paragraphs });
}
