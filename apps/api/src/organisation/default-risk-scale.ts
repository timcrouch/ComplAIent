import type { RiskLevelDto, RiskScaleDto } from "@isms/contracts";
import { DEFAULT_APPETITE_THRESHOLD } from "@isms/domain";

/**
 * The levels every new risk scale version starts from (installation data, P2-R4). Only the
 * appetite is chosen during setup.
 */
export const DEFAULT_RISK_SCALE: Readonly<{
  likelihood: readonly RiskLevelDto[];
  impact: readonly RiskLevelDto[];
}> = Object.freeze({
  likelihood: [
    { value: 1, label: "Rare", description: "Hardly ever: less than once in ten years." },
    {
      value: 2,
      label: "Unlikely",
      description: "Could happen, but not expected: about once in five to ten years.",
    },
    { value: 3, label: "Possible", description: "Might happen every few years." },
    { value: 4, label: "Likely", description: "Will probably happen this year." },
    {
      value: 5,
      label: "Almost certain",
      description: "Expected to happen several times a year.",
    },
  ],
  impact: [
    { value: 1, label: "Negligible", description: "Barely noticeable. Sorted out within a day." },
    { value: 2, label: "Minor", description: "Some disruption or cost, no lasting harm." },
    {
      value: 3,
      label: "Moderate",
      description: "Noticeable harm to customers, money or operations, but recoverable.",
    },
    {
      value: 4,
      label: "Major",
      description: "Serious harm: regulators involved, large losses or many people affected.",
    },
    {
      value: 5,
      label: "Severe",
      description: "Threatens the organisation or causes lasting harm to people.",
    },
  ],
});

/** The scale offered before the organisation has adopted one. */
export function defaultRiskScaleDto(): RiskScaleDto {
  return {
    version: null,
    appetiteThreshold: DEFAULT_APPETITE_THRESHOLD,
    likelihood: DEFAULT_RISK_SCALE.likelihood.map((l) => ({ ...l })),
    impact: DEFAULT_RISK_SCALE.impact.map((l) => ({ ...l })),
  };
}
