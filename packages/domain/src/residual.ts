import type { Treatment } from "./risk.js";

/** A rule a would-be residual assessment breaks. */
export type ResidualProblem = "residualAboveInherent" | "residualForAccept";
/** Which assessment places a risk on the map. */
export type MapBasis = "inherent" | "residual";

type Scored = {
  likelihood: number | null;
  impact: number | null;
  residualLikelihood: number | null;
  residualImpact: number | null;
  treatment: Treatment | null;
};

function above(residual: number | null, inherent: number | null): boolean {
  return residual !== null && (inherent === null || residual > inherent);
}

/** Problems with a would-be stored combination; [] when valid. Nulls are always allowed (P5-R1). */
export function residualProblems(r: Scored): ResidualProblem[] {
  const out: ResidualProblem[] = [];
  const hasResidual = r.residualLikelihood !== null || r.residualImpact !== null;
  if (r.treatment === "accept" && hasResidual) out.push("residualForAccept");
  if (above(r.residualLikelihood, r.likelihood) || above(r.residualImpact, r.impact)) {
    out.push("residualAboveInherent");
  }
  return out;
}

/** Where a risk sits on the map for `basis`, or null when it cannot be placed. */
export function mapPosition(
  r: Scored,
  basis: MapBasis,
): { likelihood: number; impact: number } | null {
  if (basis === "inherent" || r.treatment === "accept") {
    return r.likelihood !== null && r.impact !== null
      ? { likelihood: r.likelihood, impact: r.impact }
      : null;
  }
  return r.residualLikelihood !== null && r.residualImpact !== null
    ? { likelihood: r.residualLikelihood, impact: r.residualImpact }
    : null;
}
