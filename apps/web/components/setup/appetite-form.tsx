"use client";

import type { RiskScaleDto } from "@isms/contracts";
import { APPETITE_PRESETS, DEFAULT_APPETITE_THRESHOLD } from "@isms/domain";
import { cn } from "@isms/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type SubmitEvent } from "react";
import { saveRiskAppetite } from "../../lib/actions/setup";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import { AppetiteGrid } from "./appetite-grid";
import { FormFooter } from "./form-footer";
import { useSaveFlow } from "./save-flow";
import { nextStep, stepByKey } from "./steps";
import { choiceCard, choiceInput } from "./styles";

type Preset = keyof typeof APPETITE_PRESETS;
type Choice = Preset | "current";

const PRESETS = Object.keys(APPETITE_PRESETS) as Preset[];

type AppetiteFormProps = {
  /** The saved scale, or the default one; its labels head the preview. */
  scale: RiskScaleDto;
  /** The saved threshold, or null when no scale has been saved yet. */
  saved: number | null;
};

function initialChoice(saved: number | null): Choice {
  const threshold = saved ?? DEFAULT_APPETITE_THRESHOLD;
  return PRESETS.find((p) => APPETITE_PRESETS[p] === threshold) ?? "current";
}

/** Three named presets (Balanced unless a scale was saved), with a live preview grid. */
export function AppetiteForm({ scale, saved }: AppetiteFormProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const save = useSaveFlow();
  const id = useId();
  const [choice, setChoice] = useState<Choice>(() => initialChoice(saved));
  const threshold =
    choice === "current" ? (saved ?? DEFAULT_APPETITE_THRESHOLD) : APPETITE_PRESETS[choice];
  // A saved value that matches no preset (the API accepts 1–24) stays choosable.
  const options: Choice[] = initialChoice(saved) === "current" ? [...PRESETS, "current"] : PRESETS;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.busy) return;
    const result = await save.run(() => saveRiskAppetite(threshold));
    if (result.ok) {
      requestStepHeadingFocus();
      router.push(nextStep("riskAppetite").path);
    } else if (result.kind === "invalid" || result.kind === "conflict") {
      save.setFormError("notAccepted");
    }
  }

  const legendId = `${id}-legend`;
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-8">
      <fieldset role="radiogroup" aria-labelledby={legendId} className="flex flex-col gap-4">
        <legend id={legendId} className="mb-1 text-lg font-bold tracking-[-0.01em] text-fg">
          {t("riskAppetite.legend")}
        </legend>
        <div className={cn("grid gap-3", options.length > 3 ? "md:grid-cols-2" : "md:grid-cols-3")}>
          {options.map((option) => {
            const inputId = `${id}-${option}`;
            const value = option === "current" ? threshold : APPETITE_PRESETS[option];
            const copy =
              option === "current"
                ? {
                    label: t("riskAppetite.current.label"),
                    description: t("riskAppetite.current.description"),
                  }
                : {
                    label: t(`riskAppetite.presets.${option}.label`),
                    description: t(`riskAppetite.presets.${option}.description`),
                  };
            return (
              <label key={option} htmlFor={inputId} className={choiceCard}>
                <input
                  id={inputId}
                  type="radio"
                  name="appetite"
                  value={option}
                  checked={choice === option}
                  onChange={() => {
                    setChoice(option);
                  }}
                  aria-labelledby={`${inputId}-label`}
                  aria-describedby={`${inputId}-description ${inputId}-rule`}
                  className={choiceInput}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span id={`${inputId}-label`} className="text-[15px] font-semibold text-fg">
                    {copy.label}
                  </span>
                  <span
                    id={`${inputId}-description`}
                    className="text-[13px] leading-relaxed text-fg-muted"
                  >
                    {copy.description}
                  </span>
                  <span id={`${inputId}-rule`} className="text-xs font-medium text-fg-muted">
                    {t("riskAppetite.rule", { threshold: value })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-3">
        <h2 id={`${id}-preview`} className="text-lg font-bold tracking-[-0.01em] text-fg">
          {t("riskAppetite.previewTitle")}
        </h2>
        <AppetiteGrid scale={scale} threshold={threshold} />
      </section>

      <FormFooter
        status={save.status}
        formError={save.formError}
        backHref={stepByKey("frameworks").path}
      />
    </form>
  );
}
