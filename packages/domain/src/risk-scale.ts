/** A risk's score: likelihood × impact, each on the 1–5 scale. */
export function riskScore(likelihood: number, impact: number): number {
  return likelihood * impact;
}

/** A risk is above appetite only when its score exceeds the threshold. */
export function isAboveAppetite(score: number, appetiteThreshold: number): boolean {
  return score > appetiteThreshold;
}

export const MIN_APPETITE_THRESHOLD = 1;
export const MAX_APPETITE_THRESHOLD = 24;

/** Named starting points for the appetite threshold; `balanced` is the default. */
export const APPETITE_PRESETS = { cautious: 4, balanced: 9, bold: 14 } as const;

export const DEFAULT_APPETITE_THRESHOLD = APPETITE_PRESETS.balanced;
