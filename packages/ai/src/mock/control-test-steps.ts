import type { CompletionRequest } from "../provider.js";

/** Mock reply for control test steps: three steps naming the control's code from the prompt. */
export function controlTestStepsReply(request: CompletionRequest): string {
  const content = request.messages.map((m) => m.content).join("\n");
  const code = /^Code: (\S+)$/m.exec(content)?.[1] ?? "the control";
  return JSON.stringify({
    steps: [
      `Ask who is responsible for ${code} and how it is done today.`,
      `Check a small sample of records against what ${code} requires.`,
      "Write down what you found and keep the records you looked at as evidence.",
    ],
  });
}
