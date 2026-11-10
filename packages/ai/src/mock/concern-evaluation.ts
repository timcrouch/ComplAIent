import type { CompletionRequest } from "../provider.js";

const content = (request: CompletionRequest) => request.messages.map((m) => m.content).join("\n");

export function concernEvaluationReply(request: CompletionRequest): string {
  const text = content(request).toLowerCase();
  const critical = /admin|credential|ransom|breach|unknown person|unlocked/.test(text);
  return JSON.stringify({
    legitimacy: "confirmed",
    severity: critical ? "critical" : "moderate",
    confidence: 0.93,
    duplicateRiskId: null,
    reporterFeedback: critical
      ? "This appears to be a legitimate high-impact security concern. Thank you for reporting it promptly."
      : "This appears to be a legitimate security concern. Thank you for speaking up.",
    cisoRationale: critical
      ? "The report describes unauthorized access to a privileged or exposed system and warrants urgent review."
      : "The report describes a concrete security weakness with a plausible consequence.",
    uncertainty: "The CISO should confirm the facts and final severity during review.",
  });
}
