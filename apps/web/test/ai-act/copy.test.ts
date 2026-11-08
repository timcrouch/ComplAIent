import { ClassificationSourceSchema } from "@isms/contracts";
import {
  AI_ACT_ROLES,
  AI_OBLIGATION_KEYS,
  AI_OBLIGATION_STATUSES,
  AI_SYSTEM_RISK_CLASSES,
  AI_SYSTEM_STATUSES,
  ANNEX_III_AREAS,
  classifyAiSystem,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
  type ClassificationAnswers,
} from "@isms/domain";
import { describe, expect, it } from "vitest";
import { isReasonCode, REASON_CODES } from "../../components/ai-act/reason-codes";
import en from "../../messages/index";

/** The message at a dot path, or undefined. */
function at(path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      en,
    );
}

const filled = (path: string) => {
  const value = at(path);
  expect(typeof value, path).toBe("string");
  expect((value as string).trim().length, path).toBeGreaterThan(0);
};

/** A spread of answers that reaches every rule of classifyAiSystem. */
function answerSets(): ClassificationAnswers[] {
  const base: ClassificationAnswers = {
    isAiSystem: true,
    prohibitedPractices: [],
    annexISafetyComponent: false,
    annexIIIAreas: [],
    profilesPeople: null,
    derogation: null,
    transparency: [],
  };
  const sets: ClassificationAnswers[] = [base, { ...base, isAiSystem: false }];
  for (const p of PROHIBITED_PRACTICES) sets.push({ ...base, prohibitedPractices: [p] });
  sets.push({ ...base, annexISafetyComponent: true });
  for (const area of ANNEX_III_AREAS) {
    for (const derogation of DEROGATIONS) {
      for (const profilesPeople of [true, false]) {
        sets.push({ ...base, annexIIIAreas: [area], profilesPeople, derogation });
      }
    }
  }
  for (const duty of TRANSPARENCY_DUTIES) sets.push({ ...base, transparency: [duty] });
  return sets;
}

describe("EU AI Act copy", () => {
  it("has a title and a plain description for every obligation in the catalogue", () => {
    for (const key of AI_OBLIGATION_KEYS) {
      filled(`aiActRules.obligationTitles.${key}`);
      filled(`aiActRules.obligationDescriptions.${key}`);
    }
    // No copy for keys the catalogue doesn't have.
    expect(Object.keys(en.aiActRules.obligationTitles).sort()).toEqual(
      [...AI_OBLIGATION_KEYS].sort(),
    );
    expect(Object.keys(en.aiActRules.obligationDescriptions).sort()).toEqual(
      [...AI_OBLIGATION_KEYS].sort(),
    );
  });

  it("has a sentence for every reason code, and classifyAiSystem gives no other code", () => {
    for (const code of REASON_CODES) filled(`aiActRules.reasons.${code}`);
    filled("aiActRules.reasons.unknown");
    const given = new Set(
      answerSets().flatMap((a) => classifyAiSystem(a).reasons.map((r) => r.code)),
    );
    for (const code of given) expect(isReasonCode(code), code).toBe(true);
    // Every code the web knows is reachable, so none is dead copy.
    expect([...given].sort()).toEqual([...REASON_CODES].sort());
  });

  it("labels every enum value: classes, roles, statuses, obligation statuses and sources", () => {
    for (const c of AI_SYSTEM_RISK_CLASSES) filled(`aiAct.classes.${c}`);
    for (const r of AI_ACT_ROLES) filled(`aiAct.roles.${r}`);
    for (const s of AI_SYSTEM_STATUSES) filled(`aiAct.statuses.${s}`);
    for (const s of AI_OBLIGATION_STATUSES) filled(`aiAct.obligationStatuses.${s}`);
    for (const s of ClassificationSourceSchema.options) filled(`aiAct.classification.source.${s}`);
  });

  it("gives every questionnaire option a label and plain-language help", () => {
    const groups = [
      ["practices", PROHIBITED_PRACTICES],
      ["areas", ANNEX_III_AREAS],
      ["derogations", DEROGATIONS],
      ["duties", TRANSPARENCY_DUTIES],
    ] as const;
    for (const [group, values] of groups) {
      for (const value of values) {
        filled(`aiActRules.${group}.${value}.label`);
        filled(`aiActRules.${group}.${value}.help`);
      }
    }
    for (const q of ["isAiSystem", "annexI", "profilesPeople"]) {
      for (const part of ["question", "help", "yes", "no"]) filled(`aiAct.wizard.${q}.${part}`);
    }
  });

  it("says under creditworthiness that fraud detection is excluded (Annex III, point 5(b))", () => {
    expect(en.aiActRules.areas.creditworthiness.help).toMatch(/fraud/i);
    expect(en.aiActRules.areas.creditworthiness.help).toContain("5(b)");
  });
});
