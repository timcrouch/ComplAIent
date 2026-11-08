import type { AiClassificationAnswers } from "@isms/contracts";
import type { AnnexIIIArea, Derogation, ProhibitedPractice, TransparencyDuty } from "@isms/domain";

/** The questionnaire's steps, one question group each (spec §7). */
export const WIZARD_STEPS = [
  "aiSystem",
  "prohibited",
  "annexI",
  "annexIII",
  "transparency",
  "review",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Answers while they are being given: a yes/no question may still be unanswered (null). */
export type DraftAnswers = {
  isAiSystem: boolean | null;
  prohibitedPractices: ProhibitedPractice[];
  annexISafetyComponent: boolean | null;
  annexIIIAreas: AnnexIIIArea[];
  profilesPeople: boolean | null;
  derogation: Derogation | null;
  transparency: TransparencyDuty[];
};

export const EMPTY_ANSWERS: DraftAnswers = {
  isAiSystem: null,
  prohibitedPractices: [],
  annexISafetyComponent: null,
  annexIIIAreas: [],
  profilesPeople: null,
  derogation: null,
  transparency: [],
};

/** Where the wizard starts: the saved answers (reclassifying), an AI draft, or nothing. */
export function draftFrom(answers: AiClassificationAnswers | null): DraftAnswers {
  if (!answers) return EMPTY_ANSWERS;
  return {
    ...answers,
    prohibitedPractices: [...answers.prohibitedPractices],
    annexIIIAreas: [...answers.annexIIIAreas],
    transparency: [...answers.transparency],
  };
}

/** `list` with `value` added or removed, kept in the catalogue's order and without repeats. */
export function toggled<T extends string>(
  catalogue: readonly T[],
  list: readonly T[],
  value: T,
  on: boolean,
): T[] {
  return catalogue.filter((v) => (v === value ? on : list.includes(v)));
}

/** The follow-up questions (profiling, derogation) are asked only when an area is chosen. */
export const asksFollowUp = (draft: DraftAnswers): boolean => draft.annexIIIAreas.length > 0;

/** A question on this step still needs an answer before going on. */
export function unansweredOn(step: WizardStep, draft: DraftAnswers): boolean {
  switch (step) {
    case "aiSystem":
      return draft.isAiSystem === null;
    case "annexI":
      return draft.annexISafetyComponent === null;
    case "annexIII":
      return asksFollowUp(draft) && (draft.profilesPeople === null || draft.derogation === null);
    default:
      return false;
  }
}

/** Not an AI system: the Regulation doesn't apply, so the other questions are skipped. */
export function nextStep(step: WizardStep, draft: DraftAnswers): WizardStep {
  if (step === "aiSystem" && draft.isAiSystem === false) return "review";
  const i = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.min(i + 1, WIZARD_STEPS.length - 1)] as WizardStep;
}

export function previousStep(step: WizardStep, draft: DraftAnswers): WizardStep {
  if (step === "review" && draft.isAiSystem === false) return "aiSystem";
  const i = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.max(i - 1, 0)] as WizardStep;
}

/**
 * The answers to save, in the contract's shape: the follow-ups are null unless an area is
 * chosen; questions skipped because it is not an AI system count as "no". Null while a
 * question that is asked is still unanswered.
 */
export function finalAnswers(draft: DraftAnswers): AiClassificationAnswers | null {
  if (draft.isAiSystem === null) return null;
  if (!draft.isAiSystem) {
    return {
      isAiSystem: false,
      prohibitedPractices: [],
      annexISafetyComponent: false,
      annexIIIAreas: [],
      profilesPeople: null,
      derogation: null,
      transparency: [],
    };
  }
  if (draft.annexISafetyComponent === null) return null;
  const { profilesPeople, derogation } = draft;
  const asked = asksFollowUp(draft);
  if (asked && (profilesPeople === null || derogation === null)) return null;
  return {
    isAiSystem: true,
    prohibitedPractices: draft.prohibitedPractices,
    annexISafetyComponent: draft.annexISafetyComponent,
    annexIIIAreas: draft.annexIIIAreas,
    profilesPeople: asked ? profilesPeople : null,
    derogation: asked ? derogation : null,
    transparency: draft.transparency,
  };
}
