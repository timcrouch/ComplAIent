"use client";

import type { FrameworkVersionDto } from "@isms/contracts";
import { AiBadge, cn } from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { saveFrameworks } from "../../lib/actions/setup";
import type { FrameworkSuggestion } from "../../lib/framework-suggestions";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import { FormFooter } from "./form-footer";
import { FrameworkSuggest } from "./framework-suggest";
import { focusFirstInvalid, useSaveFlow } from "./save-flow";
import { nextStep, stepByKey } from "./steps";
import { choiceCard, choiceInput } from "./styles";

type FrameworksFormProps = {
  /** Every framework version in the control library. */
  frameworks: readonly FrameworkVersionDto[];
  /** Versions the organisation has confirmed; only these start checked. */
  confirmedIds: readonly string[];
  /** Open AI suggestions: labelled, with their reasoning, and never checked for the person. */
  suggestions?: readonly FrameworkSuggestion[];
  /** The AI can suggest frameworks now; otherwise there is no suggest button at all. */
  aiAvailable?: boolean;
};

/**
 * One checkbox per framework version. Nothing is pre-selected on the organisation's behalf:
 * only versions it has already confirmed start checked, and AI suggestions start unchecked.
 * Saving confirms the checked versions; the API dismisses every suggestion left unchecked.
 */
export function FrameworksForm({
  frameworks,
  confirmedIds,
  suggestions: initialSuggestions = [],
  aiAvailable = false,
}: FrameworksFormProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const save = useSaveFlow();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(confirmedIds));
  const [error, setError] = useState(false);
  const [suggestions, setSuggestions] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(initialSuggestions.map((s) => [s.frameworkVersionId, s.reasoning])),
  );

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  function toggle(versionId: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(versionId);
      else next.delete(versionId);
      return next;
    });
    setError(false);
  }

  function showError() {
    setError(true);
    save.setFormError("summary");
    focusFirstInvalid(formRef.current);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.busy) return;
    // Library order, so the request does not depend on the order of clicks.
    const ids = frameworks.map((f) => f.id).filter((fid) => chosen.has(fid));
    if (ids.length === 0) {
      showError();
      return;
    }
    const result = await save.run(() => saveFrameworks(ids));
    if (result.ok) {
      requestStepHeadingFocus();
      router.push(nextStep("frameworks").path);
    } else if (result.kind === "invalid") showError();
    else if (result.kind === "conflict") save.setFormError("notAccepted");
  }

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col">
      <fieldset aria-describedby={hintId} className="flex flex-col gap-4">
        <legend className="mb-1 text-lg font-bold tracking-[-0.01em] text-fg">
          {t("frameworks.legend")}
        </legend>
        <p id={hintId} className="max-w-[62ch] text-[13px] leading-relaxed text-fg-muted">
          {t("frameworks.hint")}
        </p>
        {aiAvailable && frameworks.length > 0 ? (
          <FrameworkSuggest
            onSuggested={(list) => {
              setSuggestions(new Map(list.map((s) => [s.frameworkVersionId, s.reasoning])));
            }}
          />
        ) : null}
        {frameworks.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("frameworks.none")}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {frameworks.map((f) => {
              const inputId = `${id}-${f.id}`;
              const summaryId = `${inputId}-summary`;
              const nameId = `${inputId}-name`;
              const reasoningId = `${inputId}-reasoning`;
              const checked = chosen.has(f.id);
              const suggested = suggestions.has(f.id);
              const reasoning = suggestions.get(f.id) ?? null;
              return (
                <li key={f.id}>
                  <label htmlFor={inputId} className={cn(choiceCard, "h-full")}>
                    <input
                      id={inputId}
                      type="checkbox"
                      value={f.id}
                      checked={checked}
                      onChange={(e) => {
                        toggle(f.id, e.target.checked);
                      }}
                      aria-labelledby={nameId}
                      aria-describedby={[
                        summaryId,
                        suggested ? reasoningId : null,
                        error ? errorId : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      {...(error ? { "aria-invalid": true } : {})}
                      className={cn(choiceInput, "rounded-[5px]")}
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span
                        id={nameId}
                        className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-fg"
                      >
                        {f.name}
                        <span className="text-[13px] font-medium text-fg-muted">
                          {f.versionLabel}
                        </span>
                      </span>
                      <span id={summaryId} className="text-[13px] leading-relaxed text-fg-muted">
                        {f.summary}
                      </span>
                      <span className="text-xs font-medium text-fg-muted">
                        {t("frameworks.requirements", { count: f.requirementCount })}
                      </span>
                      {suggested ? (
                        <span id={reasoningId} className="mt-1 flex flex-col items-start gap-1.5">
                          <AiBadge state="suggested" label={t("frameworks.suggest.badge")} />
                          {reasoning ? (
                            <span className="text-[13px] leading-relaxed text-fg">{reasoning}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <p
            id={errorId}
            className="flex items-start gap-1.5 text-[13px] leading-snug font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{t("errors.frameworks")}</span>
          </p>
        ) : null}
      </fieldset>
      <FormFooter
        status={save.status}
        formError={save.formError}
        backHref={stepByKey("sites").path}
      />
    </form>
  );
}
