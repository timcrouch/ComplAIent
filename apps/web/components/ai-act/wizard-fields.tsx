"use client";

import { AiBadge, cn } from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { choiceCard, choiceInput } from "../setup/styles";

/** One option of a question: its words and plain-language help. */
export type Choice<T extends string> = { value: T; label: string; help: string };

type QuestionProps = {
  question: string;
  help: string;
  /** The AI draft's reason for its answer, labelled as an AI suggestion. */
  rationale?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
};

/** A question as a fieldset: the question, its help, the AI's rationale, the options, a problem. */
export function Question({ question, help, rationale, error, children }: QuestionProps) {
  const t = useTranslations("aiAct.wizard");
  const id = useId();
  const describedBy = [`${id}-help`, rationale ? `${id}-ai` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <fieldset aria-describedby={describedBy} className="flex flex-col gap-3">
      <legend className="mb-1 text-[17px] font-bold text-fg">{question}</legend>
      <p id={`${id}-help`} className="max-w-[68ch] text-sm leading-relaxed text-fg-muted">
        {help}
      </p>
      {rationale ? (
        <div
          id={`${id}-ai`}
          className="flex flex-col items-start gap-1.5 rounded-md border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_35%,transparent)] p-3"
        >
          <AiBadge state="suggested" label={t("rationaleBadge")} />
          <p className="text-sm leading-relaxed text-fg">{rationale}</p>
        </div>
      ) : null}
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="flex items-start gap-1.5 text-[13px] font-medium text-critical"
        >
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

function ChoiceBody({ label, help }: { label: string; help: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-semibold text-fg">{label}</span>
      <span className="text-[13px] leading-relaxed text-fg-muted">{help}</span>
    </span>
  );
}

/** One answer of several, as selectable cards around native radios. */
export function RadioChoices<T extends string>({
  name,
  choices,
  value,
  invalid,
  onChange,
}: {
  name: string;
  choices: readonly Choice<T>[];
  value: T | null;
  invalid?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2">
      {choices.map((choice) => (
        <label key={choice.value} className={choiceCard}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            aria-invalid={invalid || undefined}
            onChange={() => {
              onChange(choice.value);
            }}
            className={choiceInput}
          />
          <ChoiceBody label={choice.label} help={choice.help} />
        </label>
      ))}
    </div>
  );
}

/** Any number of answers, as selectable cards around native checkboxes. */
export function CheckboxChoices<T extends string>({
  choices,
  values,
  columns = false,
  onChange,
}: {
  choices: readonly Choice<T>[];
  values: readonly T[];
  columns?: boolean;
  onChange: (value: T, on: boolean) => void;
}) {
  return (
    <div className={cn("grid gap-2", columns && "md:grid-cols-2")}>
      {choices.map((choice) => (
        <label key={choice.value} className={choiceCard}>
          <input
            type="checkbox"
            value={choice.value}
            checked={values.includes(choice.value)}
            onChange={(e) => {
              onChange(choice.value, e.target.checked);
            }}
            className={choiceInput}
          />
          <ChoiceBody label={choice.label} help={choice.help} />
        </label>
      ))}
    </div>
  );
}
