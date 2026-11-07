import type { RiskControlDto, RiskDetailDto, RiskScaleDto, RiskSummaryDto } from "@isms/contracts";

export const RISK_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const RIGA = { id: "8e1f6b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b", name: "Riga plant" };
export const MUNICH = { id: "9f2a7c3b-4d5e-4f6a-9b0c-1d2e3f4a5b6c", name: "Munich office" };
export const CARL = { id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", displayName: "Carl Ciso" };
export const RITA = { id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", displayName: "Rita Reporter" };
export const OLGA = { id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a", displayName: "Olga Owner" };

const level = (value: number, label: string) => ({ value, label, description: "" });

export const SCALE: RiskScaleDto = {
  version: 1,
  appetiteThreshold: 9,
  likelihood: [
    level(1, "Rare"),
    level(2, "Unlikely"),
    level(3, "Possible"),
    level(4, "Likely"),
    level(5, "Almost certain"),
  ],
  impact: [
    level(1, "Negligible"),
    level(2, "Minor"),
    level(3, "Moderate"),
    level(4, "Major"),
    level(5, "Severe"),
  ],
};

export function control(overrides: Partial<RiskControlDto> = {}): RiskControlDto {
  return {
    id: "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8a9b",
    controlId: "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d",
    code: "AST-01",
    title: "Asset inventory",
    status: "suggested",
    reason: "Matches the scenario described.",
    source: "ai",
    suggestedBy: null,
    decidedBy: null,
    decidedAt: null,
    refs: [{ framework: "iso27001-2022", ref: "A.5.9" }],
    evidenceCount: 0,
    ...overrides,
  };
}

export function riskDetail(overrides: Partial<RiskDetailDto> = {}): RiskDetailDto {
  return {
    id: RISK_ID,
    reference: "R-0001",
    title: "Laptops left in unlocked cars",
    state: "proposed",
    score: null,
    aboveAppetite: null,
    residualScore: null,
    residualAboveAppetite: null,
    owner: null,
    siteName: RIGA.name,
    updatedAt: "2026-11-05T10:00:00.000Z",
    scenario: "People leave laptops in unlocked cars.",
    threat: "Theft from cars",
    consequence: "Customer data could be read",
    existingSafeguards: "",
    toConfirm: ["What could be affected?", "Is the car park fenced?"],
    assets: [{ id: "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8a9b0c", name: "Laptops", type: "device" }],
    likelihood: null,
    impact: null,
    residualLikelihood: null,
    residualImpact: null,
    closedAt: null,
    closedBy: null,
    nextReviewDue: null,
    reviewDue: false,
    aiEstimate: { likelihood: 3, impact: 4, reasoning: "Cars are often left unlocked." },
    treatment: null,
    treatmentNote: "",
    version: 2,
    reporter: RITA,
    reviewer: null,
    siteId: RIGA.id,
    departmentId: null,
    aiAssisted: true,
    hasTranscript: true,
    controls: [],
    controlSuggestion: { status: "none", failure: null },
    evidence: [],
    approval: null,
    journey: {
      steps: [
        { key: "reported", status: "done", at: "2026-11-05T09:00:00.000Z", by: RITA },
        { key: "under_review", status: "current", at: "2026-11-05T09:00:00.000Z", by: RITA },
        { key: "awaiting_approval", status: "upcoming", at: null, by: null },
        { key: "approved", status: "upcoming", at: null, by: null },
      ],
      since: "2026-11-05T09:00:00.000Z",
      waitingOn: { kind: "owner", owner: null },
      returnCount: 0,
      cycle: "first",
      returns: [],
    },
    treatmentPlan: { actions: [], open: 0, done: 0, overdue: 0 },
    history: [
      { version: 2, changedFields: ["title"], changedBy: CARL, at: "2026-11-05T10:00:00.000Z" },
      { version: 1, changedFields: [], changedBy: RITA, at: "2026-11-05T09:00:00.000Z" },
    ],
    can: {
      edit: true,
      submit: false,
      approve: false,
      return: false,
      close: false,
      reassess: false,
      confirmReview: false,
      addEvidence: false,
      planActions: false,
      readTranscript: true,
      suggestControls: true,
    },
    ...overrides,
  };
}

export function summary(overrides: Partial<RiskSummaryDto> = {}): RiskSummaryDto {
  return {
    id: RISK_ID,
    reference: "R-0001",
    title: "Laptops left in unlocked cars",
    state: "proposed",
    score: null,
    aboveAppetite: null,
    residualScore: null,
    residualAboveAppetite: null,
    owner: null,
    siteName: RIGA.name,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  };
}

/** Owner candidates as the page passes them: who holds risk_owner or ciso, and where. */
export const OWNERS = [
  { id: CARL.id, displayName: CARL.displayName, scopes: [{ type: "organisation", id: null }] },
  { id: OLGA.id, displayName: OLGA.displayName, scopes: [{ type: "site", id: MUNICH.id }] },
] as const;

export const ok = <T>(data: T) => ({ ok: true as const, data });
export const conflict = (path: string) => ({
  ok: false as const,
  kind: "conflict" as const,
  details: [{ path, message: path }],
});
