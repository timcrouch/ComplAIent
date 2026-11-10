import type { MeResponse } from "@isms/contracts";

export const CONCERN_RANK_CHANGED = "complaient:concern-rank-changed";

export type ConcernRank = NonNullable<MeResponse["concernRank"]>;

const ranks: readonly ConcernRank[] = [
  "recruit",
  "defender",
  "protector",
  "guardian",
  "security_vanguard",
];

export function isConcernRank(value: unknown): value is ConcernRank {
  return typeof value === "string" && ranks.includes(value as ConcernRank);
}

export function rankOrder(rank: MeResponse["concernRank"]): number {
  return rank === null ? -1 : ranks.indexOf(rank);
}

export function announceConcernRank(rank: ConcernRank): void {
  window.dispatchEvent(new CustomEvent(CONCERN_RANK_CHANGED, { detail: { rank } }));
}
