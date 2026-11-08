"use client";

import type { AiClassificationDraftResponse } from "@isms/contracts";
import {
  ANNEX_III_AREAS,
  DEROGATIONS,
  PROHIBITED_PRACTICES,
  TRANSPARENCY_DUTIES,
} from "@isms/domain";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { asksFollowUp, toggled, type DraftAnswers, type WizardStep } from "./wizard-answers";
import { CheckboxChoices, Question, RadioChoices, type Choice } from "./wizard-fields";

type Rationales = AiClassificationDraftResponse["rationales"];

type Props = {
  step: Exclude<WizardStep, "review">;
  draft: DraftAnswers;
  onChange: (next: DraftAnswers) => void;
  /** The AI draft's rationales, shown under each question; null without a draft. */
  rationales: Rationales | null;
  /** Show "choose an answer" on the questions still unanswered. */
  showMissing: boolean;
};

const yesNo = (value: boolean | null): "yes" | "no" | null =>
  value === null ? null : value ? "yes" : "no";

/** The questions of one wizard step, each with plain-language help for every option. */
export function WizardStepQuestions({ step, draft, onChange, rationales, showMissing }: Props) {
  const t = useTranslations("aiAct.wizard");
  const tr = useTranslations("aiActRules");
  const name = useId();
  const missing = (unanswered: boolean) => (showMissing && unanswered ? t("chooseOne") : undefined);
  const set = (patch: Partial<DraftAnswers>) => {
    onChange({ ...draft, ...patch });
  };
  const yesNoChoices = (question: "isAiSystem" | "annexI" | "profilesPeople") =>
    (["yes", "no"] as const).map((value) => ({
      value,
      label: t(value),
      help: t(`${question}.${value}`),
    }));

  switch (step) {
    case "aiSystem":
      return (
        <Question
          question={t("isAiSystem.question")}
          help={t("isAiSystem.help")}
          rationale={rationales?.isAiSystem}
          error={missing(draft.isAiSystem === null)}
        >
          <RadioChoices
            name={`${name}-ai`}
            choices={yesNoChoices("isAiSystem")}
            value={yesNo(draft.isAiSystem)}
            invalid={showMissing && draft.isAiSystem === null}
            onChange={(v) => {
              set({ isAiSystem: v === "yes" });
            }}
          />
        </Question>
      );
    case "prohibited": {
      const choices: Choice<(typeof PROHIBITED_PRACTICES)[number]>[] = PROHIBITED_PRACTICES.map(
        (p) => ({ value: p, label: tr(`practices.${p}.label`), help: tr(`practices.${p}.help`) }),
      );
      return (
        <Question
          question={t("prohibited.question")}
          help={t("prohibited.help")}
          rationale={rationales?.prohibitedPractices}
        >
          <CheckboxChoices
            choices={choices}
            values={draft.prohibitedPractices}
            columns
            onChange={(v, on) => {
              set({
                prohibitedPractices: toggled(
                  PROHIBITED_PRACTICES,
                  draft.prohibitedPractices,
                  v,
                  on,
                ),
              });
            }}
          />
        </Question>
      );
    }
    case "annexI":
      return (
        <Question
          question={t("annexI.question")}
          help={t("annexI.help")}
          rationale={rationales?.annexISafetyComponent}
          error={missing(draft.annexISafetyComponent === null)}
        >
          <RadioChoices
            name={`${name}-annex-i`}
            choices={yesNoChoices("annexI")}
            value={yesNo(draft.annexISafetyComponent)}
            invalid={showMissing && draft.annexISafetyComponent === null}
            onChange={(v) => {
              set({ annexISafetyComponent: v === "yes" });
            }}
          />
        </Question>
      );
    case "annexIII": {
      const areas: Choice<(typeof ANNEX_III_AREAS)[number]>[] = ANNEX_III_AREAS.map((a) => ({
        value: a,
        label: tr(`areas.${a}.label`),
        help: tr(`areas.${a}.help`),
      }));
      const derogations: Choice<(typeof DEROGATIONS)[number]>[] = DEROGATIONS.map((d) => ({
        value: d,
        label: tr(`derogations.${d}.label`),
        help: tr(`derogations.${d}.help`),
      }));
      return (
        <div className="flex flex-col gap-8">
          <Question
            question={t("annexIII.question")}
            help={t("annexIII.help")}
            rationale={rationales?.annexIIIAreas}
          >
            <CheckboxChoices
              choices={areas}
              values={draft.annexIIIAreas}
              columns
              onChange={(v, on) => {
                const annexIIIAreas = toggled(ANNEX_III_AREAS, draft.annexIIIAreas, v, on);
                // The follow-ups exist only while an area is chosen (the contract's rule).
                set(
                  annexIIIAreas.length > 0
                    ? { annexIIIAreas }
                    : { annexIIIAreas, profilesPeople: null, derogation: null },
                );
              }}
            />
          </Question>
          {asksFollowUp(draft) ? (
            <>
              <Question
                question={t("profilesPeople.question")}
                help={t("profilesPeople.help")}
                rationale={rationales?.profilesPeople}
                error={missing(draft.profilesPeople === null)}
              >
                <RadioChoices
                  name={`${name}-profiling`}
                  choices={yesNoChoices("profilesPeople")}
                  value={yesNo(draft.profilesPeople)}
                  invalid={showMissing && draft.profilesPeople === null}
                  onChange={(v) => {
                    set({ profilesPeople: v === "yes" });
                  }}
                />
              </Question>
              <Question
                question={t("derogation.question")}
                help={t("derogation.help")}
                rationale={rationales?.derogation}
                error={missing(draft.derogation === null)}
              >
                <RadioChoices
                  name={`${name}-derogation`}
                  choices={derogations}
                  value={draft.derogation}
                  invalid={showMissing && draft.derogation === null}
                  onChange={(v) => {
                    set({ derogation: v });
                  }}
                />
              </Question>
            </>
          ) : null}
        </div>
      );
    }
    case "transparency": {
      const duties: Choice<(typeof TRANSPARENCY_DUTIES)[number]>[] = TRANSPARENCY_DUTIES.map(
        (d) => ({ value: d, label: tr(`duties.${d}.label`), help: tr(`duties.${d}.help`) }),
      );
      return (
        <Question
          question={t("transparency.question")}
          help={t("transparency.help")}
          rationale={rationales?.transparency}
        >
          <CheckboxChoices
            choices={duties}
            values={draft.transparency}
            onChange={(v, on) => {
              set({ transparency: toggled(TRANSPARENCY_DUTIES, draft.transparency, v, on) });
            }}
          />
        </Question>
      );
    }
  }
}
