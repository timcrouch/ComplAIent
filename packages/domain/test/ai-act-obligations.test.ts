import { describe, expect, it } from "vitest";
import {
  AI_ACT_ROLES,
  AI_OBLIGATIONS,
  AI_OBLIGATION_KEYS,
  ANNEX_III_AREAS,
  type AiActRole,
  type AiObligationKey,
  type ClassificationAnswers,
  applicableObligations,
  classifyAiSystem,
} from "../src/index.js";

const base: ClassificationAnswers = {
  isAiSystem: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIAreas: [],
  profilesPeople: null,
  derogation: null,
  transparency: [],
};
const ALL_TRANSPARENCY: ClassificationAnswers["transparency"] = [
  "interacts_with_people",
  "generates_synthetic_content",
  "emotion_recognition_or_biometric_categorisation",
  "deep_fake",
  "public_interest_text",
];

/** One answer set per path through the rules. */
const CASES = {
  out_of_scope: { ...base, isAiSystem: false, transparency: ALL_TRANSPARENCY },
  prohibited: { ...base, prohibitedPractices: ["social_scoring"], transparency: ALL_TRANSPARENCY },
  high_risk_credit: {
    ...base,
    annexIIIAreas: ["creditworthiness"],
    profilesPeople: true,
    derogation: "none",
  },
  high_risk_employment: {
    ...base,
    annexIIIAreas: ["employment"],
    profilesPeople: false,
    derogation: "none",
  },
  derogation: {
    ...base,
    annexIIIAreas: ["employment"],
    profilesPeople: false,
    derogation: "preparatory_task",
  },
  limited_risk: { ...base, transparency: ALL_TRANSPARENCY },
  minimal_risk: base,
} satisfies Record<string, ClassificationAnswers>;
type Case = keyof typeof CASES;

const PROVIDER_HIGH_RISK: AiObligationKey[] = [
  "risk_management_system",
  "data_governance",
  "technical_documentation",
  "automatic_logging",
  "instructions_for_deployers",
  "human_oversight_by_design",
  "accuracy_robustness_security",
  "quality_management_system",
  "conformity_assessment",
  "eu_declaration_and_ce_marking",
  "eu_database_registration",
  "post_market_monitoring",
  "serious_incident_reporting",
  "corrective_actions",
];
const DEPLOYER_HIGH_RISK: AiObligationKey[] = [
  "use_per_instructions",
  "assign_human_oversight",
  "input_data_quality",
  "monitor_and_report",
  "keep_logs_six_months",
  "inform_workers",
  "inform_affected_people",
  "dpia_where_required",
  "right_to_explanation",
];
const PROVIDER_TRANSPARENCY: AiObligationKey[] = [
  "disclose_ai_interaction",
  "mark_synthetic_content",
];
const DEPLOYER_TRANSPARENCY: AiObligationKey[] = [
  "inform_emotion_or_biometric_exposure",
  "disclose_deep_fake",
  "disclose_ai_generated_text",
];

const EXPECTED: Record<Case, Record<AiActRole, AiObligationKey[]>> = {
  out_of_scope: { provider: [], deployer: [], importer: [], distributor: [] },
  prohibited: {
    provider: ["ai_literacy", "stop_prohibited_practice"],
    deployer: ["ai_literacy", "stop_prohibited_practice"],
    importer: ["stop_prohibited_practice"],
    distributor: ["stop_prohibited_practice"],
  },
  high_risk_credit: {
    provider: ["ai_literacy", ...PROVIDER_HIGH_RISK],
    deployer: ["ai_literacy", ...DEPLOYER_HIGH_RISK, "fundamental_rights_impact_assessment"],
    importer: ["importer_verification"],
    distributor: ["distributor_verification"],
  },
  high_risk_employment: {
    provider: ["ai_literacy", ...PROVIDER_HIGH_RISK],
    deployer: ["ai_literacy", ...DEPLOYER_HIGH_RISK],
    importer: ["importer_verification"],
    distributor: ["distributor_verification"],
  },
  derogation: {
    provider: ["ai_literacy", "document_not_high_risk_assessment", "register_not_high_risk"],
    deployer: ["ai_literacy"],
    importer: [],
    distributor: [],
  },
  limited_risk: {
    provider: ["ai_literacy", ...PROVIDER_TRANSPARENCY],
    deployer: ["ai_literacy", ...DEPLOYER_TRANSPARENCY],
    importer: [],
    distributor: [],
  },
  minimal_risk: {
    provider: ["ai_literacy"],
    deployer: ["ai_literacy"],
    importer: [],
    distributor: [],
  },
};

const ROWS = (Object.keys(CASES) as Case[]).flatMap((c) =>
  AI_ACT_ROLES.map((role) => [c, role] as const),
);

describe("applicableObligations: role × class", () => {
  it.each(ROWS)("%s as %s", (c, role) => {
    const answers = CASES[c];
    expect(applicableObligations(classifyAiSystem(answers), role, answers)).toEqual(
      EXPECTED[c][role],
    );
  });
});

describe("applicableObligations: details", () => {
  it.each(ANNEX_III_AREAS)("a high-risk deployer in %s gets the FRIA only in 5(a)-(c)", (area) => {
    const answers: ClassificationAnswers = {
      ...base,
      annexIIIAreas: [area],
      profilesPeople: true,
      derogation: "none",
    };
    const keys = applicableObligations(classifyAiSystem(answers), "deployer", answers);
    const fria = ["creditworthiness", "life_health_insurance", "essential_public_services"];
    expect(keys.includes("fundamental_rights_impact_assessment")).toBe(fria.includes(area));
  });

  it("a high-risk Annex I provider with a transparency duty gets both sets", () => {
    const answers: ClassificationAnswers = {
      ...base,
      annexISafetyComponent: true,
      transparency: ["interacts_with_people"],
    };
    expect(applicableObligations(classifyAiSystem(answers), "provider", answers)).toEqual([
      "ai_literacy",
      ...PROVIDER_HIGH_RISK,
      "disclose_ai_interaction",
    ]);
  });

  it("a deployer gets only the transparency duties that apply", () => {
    const answers: ClassificationAnswers = { ...base, transparency: ["deep_fake"] };
    expect(applicableObligations(classifyAiSystem(answers), "deployer", answers)).toEqual([
      "ai_literacy",
      "disclose_deep_fake",
    ]);
  });
});

describe("the obligation catalogue", () => {
  it("has unique keys, each with an article", () => {
    expect(new Set(AI_OBLIGATION_KEYS).size).toBe(AI_OBLIGATIONS.length);
    expect(AI_OBLIGATIONS.map((o) => o.key)).toEqual(AI_OBLIGATION_KEYS);
    for (const o of AI_OBLIGATIONS) expect(o.article).toMatch(/^Art\. \d+/);
  });

  it("names the articles of the spec", () => {
    const article = (key: AiObligationKey) => AI_OBLIGATIONS.find((o) => o.key === key)?.article;
    expect(article("ai_literacy")).toBe("Art. 4");
    expect(article("fundamental_rights_impact_assessment")).toBe("Art. 27");
    expect(article("eu_declaration_and_ce_marking")).toBe("Art. 47–48");
    expect(article("register_not_high_risk")).toBe("Art. 49(2)");
    expect(article("dpia_where_required")).toBe("Art. 26(9)");
    expect(article("disclose_ai_generated_text")).toBe("Art. 50(4)");
  });

  it("every key applies on some path (no dead entries)", () => {
    const reached = new Set<AiObligationKey>();
    for (const [c, role] of ROWS) for (const k of EXPECTED[c][role]) reached.add(k);
    expect([...reached].sort()).toEqual([...AI_OBLIGATION_KEYS].sort());
  });
});
