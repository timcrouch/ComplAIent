import { describe, expect, it } from "vitest";
import {
  ANNEX_III_AREAS,
  type ClassificationAnswers,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
  classifyAiSystem,
} from "../src/index.js";

/** An AI system with no prohibited practice, no high-risk use and no transparency duty. */
const base: ClassificationAnswers = {
  isAiSystem: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIAreas: [],
  profilesPeople: null,
  derogation: null,
  transparency: [],
};
const answers = (overrides: Partial<ClassificationAnswers>): ClassificationAnswers => ({
  ...base,
  ...overrides,
});

describe("classifyAiSystem: out of scope", () => {
  it("is out_of_scope when it is not an AI system, whatever else is answered", () => {
    const result = classifyAiSystem(
      answers({
        isAiSystem: false,
        prohibitedPractices: ["social_scoring"],
        annexISafetyComponent: true,
        annexIIIAreas: ["creditworthiness"],
        profilesPeople: true,
        derogation: "none",
        transparency: ["interacts_with_people"],
      }),
    );
    expect(result).toEqual({
      riskClass: "out_of_scope",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [{ code: "not_ai_system", article: "Art. 3(1)" }],
    });
  });
});

describe("classifyAiSystem: prohibited", () => {
  it.each(PROHIBITED_PRACTICES.map((p, i) => [p, String.fromCharCode(97 + i)] as const))(
    "%s is prohibited under Art. 5(1)(%s)",
    (practice, letter) => {
      const result = classifyAiSystem(answers({ prohibitedPractices: [practice] }));
      expect(result.riskClass).toBe("prohibited");
      expect(result.reasons).toEqual([
        { code: `prohibited.${practice}`, article: `Art. 5(1)(${letter})` },
      ]);
    },
  );

  it("wins over high-risk and transparency, and carries no other duty or reason", () => {
    const result = classifyAiSystem(
      answers({
        prohibitedPractices: ["social_scoring", "subliminal_manipulation"],
        annexISafetyComponent: true,
        annexIIIAreas: ["employment"],
        profilesPeople: true,
        derogation: "none",
        transparency: ["interacts_with_people"],
      }),
    );
    expect(result).toEqual({
      riskClass: "prohibited",
      transparencyDuties: [],
      derogationApplied: false,
      // In catalogue order, not answer order.
      reasons: [
        { code: "prohibited.subliminal_manipulation", article: "Art. 5(1)(a)" },
        { code: "prohibited.social_scoring", article: "Art. 5(1)(c)" },
      ],
    });
  });
});

describe("classifyAiSystem: high-risk", () => {
  it("is high_risk as an Annex I safety component (Art. 6(1))", () => {
    const result = classifyAiSystem(answers({ annexISafetyComponent: true }));
    expect(result).toEqual({
      riskClass: "high_risk",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [{ code: "annex_i.safety_component", article: "Art. 6(1)" }],
    });
  });

  it("is high_risk for an Annex III area with no derogation (Art. 6(2))", () => {
    const result = classifyAiSystem(
      answers({ annexIIIAreas: ["creditworthiness"], profilesPeople: false, derogation: "none" }),
    );
    expect(result).toEqual({
      riskClass: "high_risk",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [
        { code: "annex_iii.creditworthiness", article: "Annex III, point 5(b)" },
        { code: "annex_iii.no_derogation", article: "Art. 6(2)" },
      ],
    });
  });

  it("names the Annex III point of every area", () => {
    const points = ANNEX_III_AREAS.map(
      (area) =>
        classifyAiSystem(
          answers({ annexIIIAreas: [area], profilesPeople: false, derogation: "none" }),
        ).reasons[0]?.article,
    );
    expect(points).toEqual([
      "Annex III, point 1",
      "Annex III, point 2",
      "Annex III, point 3",
      "Annex III, point 4",
      "Annex III, point 5(a)",
      "Annex III, point 5(b)",
      "Annex III, point 5(c)",
      "Annex III, point 5(d)",
      "Annex III, point 6",
      "Annex III, point 7",
      "Annex III, point 8",
    ]);
  });

  it.each(DEROGATIONS.filter((d) => d !== "none"))(
    "profiling is always high_risk, even with the derogation %s (Art. 6(3), last subparagraph)",
    (derogation) => {
      const result = classifyAiSystem(
        answers({ annexIIIAreas: ["employment"], profilesPeople: true, derogation }),
      );
      expect(result).toEqual({
        riskClass: "high_risk",
        transparencyDuties: [],
        derogationApplied: false,
        reasons: [
          { code: "annex_iii.employment", article: "Annex III, point 4" },
          { code: "annex_iii.profiling", article: "Art. 6(3)" },
        ],
      });
    },
  );

  it("treats unanswered profiling or derogation as no derogation (conservative)", () => {
    for (const partial of [
      { profilesPeople: null, derogation: "preparatory_task" },
      { profilesPeople: false, derogation: null },
    ] as const) {
      const result = classifyAiSystem(answers({ annexIIIAreas: ["education"], ...partial }));
      expect(result.riskClass).toBe("high_risk");
      expect(result.derogationApplied).toBe(false);
    }
  });

  it("lists every chosen area in catalogue order, and Annex I first", () => {
    const result = classifyAiSystem(
      answers({
        annexISafetyComponent: true,
        annexIIIAreas: ["life_health_insurance", "biometrics"],
        profilesPeople: false,
        derogation: "none",
      }),
    );
    expect(result.reasons.map((r) => r.code)).toEqual([
      "annex_i.safety_component",
      "annex_iii.biometrics",
      "annex_iii.life_health_insurance",
      "annex_iii.no_derogation",
    ]);
  });

  it("an Annex I component stays high_risk when an Annex III derogation would apply", () => {
    const result = classifyAiSystem(
      answers({
        annexISafetyComponent: true,
        annexIIIAreas: ["critical_infrastructure"],
        profilesPeople: false,
        derogation: "narrow_procedural_task",
      }),
    );
    expect(result).toEqual({
      riskClass: "high_risk",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [
        { code: "annex_i.safety_component", article: "Art. 6(1)" },
        { code: "annex_iii.critical_infrastructure", article: "Annex III, point 2" },
      ],
    });
  });

  it("keeps transparency duties on top of high-risk", () => {
    const result = classifyAiSystem(
      answers({
        annexIIIAreas: ["employment"],
        profilesPeople: true,
        derogation: "none",
        transparency: ["deep_fake", "interacts_with_people"],
      }),
    );
    expect(result.riskClass).toBe("high_risk");
    expect(result.transparencyDuties).toEqual(["interacts_with_people", "deep_fake"]);
    expect(result.reasons.slice(-2)).toEqual([
      { code: "transparency.interacts_with_people", article: "Art. 50(1)" },
      { code: "transparency.deep_fake", article: "Art. 50(4)" },
    ]);
  });
});

describe("classifyAiSystem: the Art. 6(3) derogation", () => {
  it.each(
    DEROGATIONS.filter((d) => d !== "none").map(
      (d, i) => [d, `Art. 6(3)(${String.fromCharCode(97 + i)})`] as const,
    ),
  )("%s without profiling is not high-risk (%s)", (derogation, article) => {
    const result = classifyAiSystem(
      answers({ annexIIIAreas: ["creditworthiness"], profilesPeople: false, derogation }),
    );
    expect(result).toEqual({
      riskClass: "minimal_risk",
      transparencyDuties: [],
      derogationApplied: true,
      reasons: [
        { code: "annex_iii.creditworthiness", article: "Annex III, point 5(b)" },
        { code: `derogation.${derogation}`, article },
        { code: "minimal_risk", article: "Art. 95" },
      ],
    });
  });

  it("is limited_risk with a derogation and a transparency duty", () => {
    const result = classifyAiSystem(
      answers({
        annexIIIAreas: ["essential_public_services"],
        profilesPeople: false,
        derogation: "preparatory_task",
        transparency: ["public_interest_text"],
      }),
    );
    expect(result).toEqual({
      riskClass: "limited_risk",
      transparencyDuties: ["public_interest_text"],
      derogationApplied: true,
      reasons: [
        { code: "annex_iii.essential_public_services", article: "Annex III, point 5(a)" },
        { code: "derogation.preparatory_task", article: "Art. 6(3)(d)" },
        { code: "transparency.public_interest_text", article: "Art. 50(4)" },
      ],
    });
  });

  it("ignores profiling and derogation answers when no Annex III area is chosen", () => {
    const result = classifyAiSystem(answers({ profilesPeople: true, derogation: "none" }));
    expect(result.riskClass).toBe("minimal_risk");
    expect(result.derogationApplied).toBe(false);
  });
});

describe("classifyAiSystem: limited and minimal risk", () => {
  it.each(
    TRANSPARENCY_DUTIES.map(
      (d, i) =>
        [d, ["Art. 50(1)", "Art. 50(2)", "Art. 50(3)", "Art. 50(4)", "Art. 50(4)"][i]] as const,
    ),
  )("%s alone is limited_risk (%s)", (duty, article) => {
    expect(classifyAiSystem(answers({ transparency: [duty] }))).toEqual({
      riskClass: "limited_risk",
      transparencyDuties: [duty],
      derogationApplied: false,
      reasons: [{ code: `transparency.${duty}`, article }],
    });
  });

  it("is minimal_risk with nothing that applies", () => {
    expect(classifyAiSystem(base)).toEqual({
      riskClass: "minimal_risk",
      transparencyDuties: [],
      derogationApplied: false,
      reasons: [{ code: "minimal_risk", article: "Art. 95" }],
    });
  });

  it("ignores repeated answers", () => {
    const result = classifyAiSystem(
      answers({ transparency: ["interacts_with_people", "interacts_with_people"] }),
    );
    expect(result.transparencyDuties).toEqual(["interacts_with_people"]);
    expect(result.reasons).toHaveLength(1);
  });
});
