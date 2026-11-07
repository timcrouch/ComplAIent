/**
 * P7-R3: notImplemented = no accepted use; implementedNotTested = accepted, no test;
 * implementedTested = latest test effective or partially effective;
 * implementedIneffective = latest test ineffective.
 */
export type ImplementationStatus =
  "implementedTested" | "implementedNotTested" | "implementedIneffective" | "notImplemented";

export function implementationStatus(c: {
  acceptedOnRisks: number;
  latestResult?: "effective" | "partially_effective" | "ineffective" | null | undefined;
}): ImplementationStatus {
  if (c.acceptedOnRisks <= 0) return "notImplemented";
  if (c.latestResult == null) return "implementedNotTested";
  return c.latestResult === "ineffective" ? "implementedIneffective" : "implementedTested";
}

/**
 * Suggests applicability (P7-R9): "used" when any risk anywhere has a mapped control accepted,
 * naming only the risks the viewer may see and counting the others (`hiddenCount`), so a scoped
 * viewer's hint never contradicts the organisation-wide implementation status. "unused" means
 * no accepted use at all. A hint, never a decision.
 */
export function applicabilityHint(uses: {
  visibleRefs: readonly string[];
  hiddenCount: number;
}): { kind: "used"; refs: string[]; hiddenCount: number } | { kind: "unused" } {
  return uses.visibleRefs.length > 0 || uses.hiddenCount > 0
    ? { kind: "used", refs: [...uses.visibleRefs], hiddenCount: uses.hiddenCount }
    : { kind: "unused" };
}
