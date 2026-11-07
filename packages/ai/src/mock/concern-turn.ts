import type { CompletionRequest } from "../provider.js";

export const MOCK_ESTIMATE_REASONING = "Estimated from the description.";

const QUESTIONS = [
  { question: "Which site is this about?", field: "location", chips: null },
  {
    question: "What could be affected?",
    field: "asset",
    chips: ["Customer data", "A system or app", "A device", "A building"],
  },
  {
    question: "Is anything already protecting against this?",
    field: "safeguards",
    chips: ["Yes", "No"],
  },
] as const;

const ASSET_TYPE_BY_CHIP: Readonly<Record<string, string>> = {
  "Customer data": "information",
  "A system or app": "application",
  "A device": "device",
  "A building": "facility",
};

/** The reporter's words back from `<reporter>` blocks (wrapUntrusted escapes &, < and >). */
function reporterTexts(request: CompletionRequest): string[] {
  const texts: string[] = [];
  for (const m of request.messages) {
    if (m.role !== "user") continue;
    for (const block of m.content.matchAll(/<reporter>\n([\s\S]*?)\n<\/reporter>/g)) {
      const text = (block[1] ?? "")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
      texts.push(text);
    }
  }
  return texts;
}

/** The site names listed in the system prompt (`Site names (JSON): [...]`). */
function siteNames(system: string): string[] {
  const line = /^Site names \(JSON\): (.*)$/m.exec(system)?.[1];
  if (line === undefined) return [];
  const parsed = JSON.parse(line) as unknown;
  return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Mock reply for a concern turn: asks the site, what is affected and the safeguards, in that
 * order, then summarises (at once when the prompt says the questions are used up).
 */
export function concernTurnReply(request: CompletionRequest): string {
  const asked = request.messages.filter((m) => m.role === "assistant").length;
  const mustSummarise = /You must now summarise/.test(request.system);
  const next = QUESTIONS[asked];
  if (next && !mustSummarise) {
    const chips =
      next.chips ??
      siteNames(request.system)
        .filter((s) => s.length <= 40)
        .slice(0, 6);
    return JSON.stringify({
      kind: "question",
      question: next.question,
      chips,
      field: next.field,
      draft: null,
    });
  }
  const texts = reporterTexts(request);
  const [first = "", site, affected, safeguards] = texts;
  const estimate = (value: number) => ({ value, reasoning: MOCK_ESTIMATE_REASONING });
  return JSON.stringify({
    kind: "summary",
    question: null,
    chips: [],
    field: null,
    draft: {
      title: first.slice(0, 80),
      scenario: texts.join("\n").slice(0, 2000),
      assets:
        affected === undefined
          ? []
          : [{ name: affected.slice(0, 120), type: ASSET_TYPE_BY_CHIP[affected] ?? "other" }],
      threat: first.slice(0, 1000),
      consequence: "",
      existingSafeguards:
        safeguards === undefined || safeguards === "No" ? "" : safeguards.slice(0, 1000),
      siteName: site === undefined ? null : site.slice(0, 120),
      toConfirm: [],
      likelihood: estimate(3),
      impact: estimate(4),
    },
  });
}
