import type { BoardPackResponse, RiskScaleDto } from "@isms/contracts";

const level = (value: number, label: string) => ({ value, label, description: label });
export const SCALE = {
  likelihood: [1, 2, 3, 4, 5].map((v) => level(v, `L${String(v)}`)),
  impact: [1, 2, 3, 4, 5].map((v) => level(v, `I${String(v)}`)),
} as unknown as RiskScaleDto;

const map = (basis: "inherent" | "residual") => ({
  basis,
  appetiteThreshold: 12,
  cells: [{ likelihood: 4, impact: 4, count: 3 }],
  total: 3,
  unscored: 0,
  unplaced: 0,
});

export const PACK: BoardPackResponse = {
  generatedAt: "2026-11-06T10:00:00.000Z",
  generatedBy: "Rita Reader",
  organisation: "Acme GmbH",
  scope: { kind: "organisation" },
  period: { key: "2026-Q3", start: "2026-07-01", end: "2026-09-30" },
  periods: [
    { key: "2026-Q3", start: "2026-07-01", end: "2026-09-30" },
    { key: "2026-Q2", start: "2026-04-01", end: "2026-06-30" },
  ],
  facts: {
    openRisks: 17,
    aboveAppetite: 5,
    reported: 8,
    approved: 6,
    closed: 2,
    overdueActions: 4,
    reviewsDue: 3,
  },
  tiles: [
    { key: "openRisks", value: 17, change: null },
    { key: "aboveAppetite", value: 5, change: null },
    { key: "reported", value: 8, change: null },
    { key: "approved", value: 6, change: null },
    { key: "closed", value: 2, change: null },
    { key: "overdueActions", value: 4, change: null },
    { key: "reviewsDue", value: 3, change: null },
  ],
  topRisks: [
    {
      reference: "RISK-0007",
      title: "Data loss at site A",
      owner: "Oscar Owner",
      treatment: "mitigate",
      score: 20,
      residualScore: 8,
      actions: { done: 1, total: 3 },
    },
  ],
  mapNow: map("inherent"),
  mapExpected: map("residual"),
  movement: Array.from({ length: 12 }, (_, i) => ({
    weekStart: `2026-0${String(i < 9 ? 7 : 7)}-${String(i + 1).padStart(2, "0")}`,
    reported: i,
    approved: 0,
    closed: 0,
    openAtEnd: 17,
  })),
  owners: [
    {
      ownerId: "0194f0c0-0000-7000-8000-0000000000a1",
      owner: "Oscar Owner",
      owned: 9,
      open: 8,
      closedNow: 1,
      treatedInPeriod: 1,
      overdueActions: 2,
    },
  ],
  narrative: null,
  canDraftNarrative: false,
  canApproveNarrative: false,
};
