import { describe, expect, it } from "vitest";
import {
  AiClassificationAnswers,
  AiClassificationRecord,
  AiSystemInput,
  AiSystemUpdateInput,
  ClassifyAiSystemInput,
  MeResponse,
  OrganisationResponse,
  SetModuleInput,
  UpdateAiObligationInput,
} from "../src/index.js";

const answers = {
  isAiSystem: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIAreas: ["creditworthiness"],
  profilesPeople: true,
  derogation: "none",
  transparency: ["interacts_with_people"],
};

const system = {
  name: "Credit scoring engine",
  description: "",
  intendedPurpose: "Scores consumer loan applications.",
  role: "deployer",
  supplier: "Vendor GmbH",
  model: null,
  usesGeneralPurposeModel: false,
  status: "in_use",
  ownerId: "0190a6f2-0000-7000-8000-000000000001",
  departmentId: null,
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join("."));

describe("AiClassificationAnswers", () => {
  it("accepts consistent answers", () => {
    expect(AiClassificationAnswers.safeParse(answers).success).toBe(true);
    expect(
      AiClassificationAnswers.safeParse({
        ...answers,
        annexIIIAreas: [],
        profilesPeople: null,
        derogation: null,
      }).success,
    ).toBe(true);
  });

  it("requires the Annex III follow-ups only when an area is chosen", () => {
    expect(issuePaths(AiClassificationAnswers.safeParse({ ...answers, derogation: null }))).toEqual(
      ["derogation"],
    );
    expect(
      issuePaths(AiClassificationAnswers.safeParse({ ...answers, annexIIIAreas: [] })),
    ).toEqual(["profilesPeople", "derogation"]);
  });

  it("refuses repeats, unknown values and extra fields", () => {
    expect(
      issuePaths(
        AiClassificationAnswers.safeParse({
          ...answers,
          annexIIIAreas: ["creditworthiness", "creditworthiness"],
        }),
      ),
    ).toEqual(["annexIIIAreas.1"]);
    expect(
      AiClassificationAnswers.safeParse({ ...answers, transparency: ["fraud_detection"] }).success,
    ).toBe(false);
    expect(
      AiClassificationAnswers.safeParse({ ...answers, riskClass: "minimal_risk" }).success,
    ).toBe(false);
  });

  it("never takes a class from the client", () => {
    expect(
      ClassifyAiSystemInput.safeParse({ answers, interactionId: null, riskClass: "minimal_risk" })
        .success,
    ).toBe(false);
    expect(ClassifyAiSystemInput.safeParse({ answers, interactionId: null }).success).toBe(true);
  });

  it("checks a stored record, answers and result together", () => {
    const record = {
      version: 1,
      answers,
      source: "manual",
      result: {
        riskClass: "high_risk",
        transparencyDuties: ["interacts_with_people"],
        derogationApplied: false,
        reasons: [{ code: "annex_iii.creditworthiness", article: "Annex III, point 5(b)" }],
      },
    };
    expect(AiClassificationRecord.safeParse(record).success).toBe(true);
    expect(AiClassificationRecord.safeParse({ ...record, version: 2 }).success).toBe(false);
    expect(
      AiClassificationRecord.safeParse({ ...record, result: { ...record.result, riskClass: "x" } })
        .success,
    ).toBe(false);
  });
});

describe("AI system inputs", () => {
  it("accepts a complete profile and trims text", () => {
    const parsed = AiSystemInput.parse({ ...system, name: "  Credit scoring engine " });
    expect(parsed.name).toBe("Credit scoring engine");
  });

  it("refuses a missing intended purpose, a bad owner id and extra fields", () => {
    expect(issuePaths(AiSystemInput.safeParse({ ...system, intendedPurpose: " " }))).toEqual([
      "intendedPurpose",
    ]);
    expect(issuePaths(AiSystemInput.safeParse({ ...system, ownerId: "me" }))).toEqual(["ownerId"]);
    expect(AiSystemInput.safeParse({ ...system, riskClass: "high_risk" }).success).toBe(false);
  });

  it("updates any one field, but not none", () => {
    expect(AiSystemUpdateInput.safeParse({ status: "retired" }).success).toBe(true);
    expect(AiSystemUpdateInput.safeParse({ departmentId: null }).success).toBe(true);
    expect(AiSystemUpdateInput.safeParse({}).success).toBe(false);
  });

  it("updates an obligation's status or note, bounded to 2000 characters", () => {
    expect(UpdateAiObligationInput.safeParse({ status: "met" }).success).toBe(true);
    expect(UpdateAiObligationInput.safeParse({ note: "" }).success).toBe(true);
    expect(UpdateAiObligationInput.safeParse({ note: "x".repeat(2001) }).success).toBe(false);
    expect(UpdateAiObligationInput.safeParse({}).success).toBe(false);
  });
});

describe("modules", () => {
  it("switches a module with a strict boolean body", () => {
    expect(SetModuleInput.safeParse({ enabled: true }).success).toBe(true);
    expect(SetModuleInput.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(SetModuleInput.safeParse({ enabled: true, key: "eu_ai_act" }).success).toBe(false);
  });

  it("lists the modules on /me and /organisation", () => {
    expect(MeResponse.shape.modules.safeParse(["eu_ai_act"]).success).toBe(true);
    expect(OrganisationResponse.shape.modules.safeParse(["dora"]).success).toBe(false);
  });
});
