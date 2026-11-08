import type { AiObligationDto, AiSystemDetailDto, AiSystemSummaryDto } from "@isms/contracts";

export const SYSTEM_ID = "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0001";
export const RISK_ID = "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0002";
export const CARL = { id: "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0003", displayName: "Carl Ciso" };

export function summary(overrides: Partial<AiSystemSummaryDto> = {}): AiSystemSummaryDto {
  return {
    id: SYSTEM_ID,
    name: "Credit scoring engine",
    role: "deployer",
    status: "in_use",
    riskClass: "unclassified",
    owner: CARL,
    department: null,
    openObligationCount: 0,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

export function obligation(overrides: Partial<AiObligationDto> = {}): AiObligationDto {
  return {
    key: "ai_literacy",
    article: "Art. 4",
    applicable: true,
    status: "open",
    note: "",
    updatedAt: "2026-11-01T10:00:00.000Z",
    updatedBy: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<AiSystemDetailDto> = {}): AiSystemDetailDto {
  return {
    ...summary(),
    description: "Scores loan applications.",
    intendedPurpose: "Assess the creditworthiness of private loan applicants.",
    supplier: "Vendor GmbH",
    model: "scoring engine v4",
    usesGeneralPurposeModel: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    classification: null,
    obligations: [],
    risks: [],
    canDraftClassification: false,
    canSuggestGuidance: false,
    ...overrides,
  };
}

/** The credit scoring engine as a classified, high-risk deployer system. */
export function highRisk(overrides: Partial<AiSystemDetailDto> = {}): AiSystemDetailDto {
  return detail({
    riskClass: "high_risk",
    openObligationCount: 2,
    classification: {
      answers: {
        isAiSystem: true,
        prohibitedPractices: [],
        annexISafetyComponent: false,
        annexIIIAreas: ["creditworthiness"],
        profilesPeople: true,
        derogation: "none",
        transparency: [],
      },
      source: "manual",
      result: {
        riskClass: "high_risk",
        transparencyDuties: [],
        derogationApplied: false,
        reasons: [
          { code: "annex_iii.creditworthiness", article: "Annex III, point 5(b)" },
          { code: "annex_iii.profiling", article: "Art. 6(3)" },
        ],
      },
      classifiedAt: "2026-11-02T10:00:00.000Z",
      classifiedBy: CARL,
    },
    obligations: [
      obligation(),
      obligation({ key: "use_per_instructions", article: "Art. 26(1)", status: "in_progress" }),
      obligation({
        key: "disclose_ai_interaction",
        article: "Art. 50(1)",
        applicable: false,
        status: "met",
        note: "Banner added.",
      }),
    ],
    ...overrides,
  });
}
