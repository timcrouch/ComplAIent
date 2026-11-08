import type { CompletionRequest } from "../provider.js";

export const MOCK_AI_ACT_RATIONALE = "Suggested from the profile — please check.";

const userText = (request: CompletionRequest) =>
  request.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

/**
 * Mock classification draft, from words in the profile: credit or loan → creditworthiness,
 * CV, recruit or candidate → employment (both profiling, no derogation); chat → interacts
 * with people. Anything else: an AI system with nothing that applies.
 */
export function aiActClassificationReply(request: CompletionRequest): string {
  const text = userText(request).toLowerCase();
  const areas = [
    ...(/credit|loan/.test(text) ? ["creditworthiness"] : []),
    ...(/\bcv\b|recruit|candidate/.test(text) ? ["employment"] : []),
  ];
  const asked = areas.length > 0;
  const rationales = Object.fromEntries(
    [
      "isAiSystem",
      "prohibitedPractices",
      "annexISafetyComponent",
      "annexIIIAreas",
      "profilesPeople",
      "derogation",
      "transparency",
    ].map((key) => [key, MOCK_AI_ACT_RATIONALE]),
  );
  return JSON.stringify({
    answers: {
      isAiSystem: true,
      prohibitedPractices: [],
      annexISafetyComponent: false,
      annexIIIAreas: areas,
      profilesPeople: asked ? true : null,
      derogation: asked ? "none" : null,
      transparency: /chat/.test(text) ? ["interacts_with_people"] : [],
    },
    rationales,
  });
}

/** Mock obligation guidance: three steps naming the obligation and article from the prompt. */
export function aiActGuidanceReply(request: CompletionRequest): string {
  const match = /^Obligation: (\S+) \((.+)\)$/m.exec(userText(request));
  const key = match?.[1] ?? "the obligation";
  const article = match?.[2] ?? "the article";
  return JSON.stringify({
    steps: [
      `Read ${article} and write down who is responsible for ${key}.`,
      `Check what the system does today against ${article}.`,
      "Record what is missing and agree a date to close each gap.",
    ],
    evidenceHint: `A dated record showing how ${key} is met.`,
  });
}
