"use client";

import {
  conflictReasons,
  ControlTestResultSchema,
  RecordControlTestInput,
  type ControlOperationDto,
  type ControlTestResult,
} from "@isms/contracts";
import { AiBadge, Button, cn, Field, fieldA11y, Input, Textarea } from "@isms/ui";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { recordControlTest, suggestTestSteps } from "../../lib/actions/library";
import { goTo } from "../../lib/navigate";
import { settle, signInAgain } from "../risks/risk-call";
import { choiceCard, choiceInput } from "../setup/styles";
import { RESULT_ICON } from "./test-result";

type FieldName = "testedOn" | "result" | "method" | "notes" | "evidence";
type FormError = "forbidden" | "unavailable" | "notAccepted";
type Errors = Partial<Record<FieldName, true>>;

/** The form field a contract path belongs to. */
function fieldOf(path: string): FieldName | null {
  const head = path.split(".")[0];
  if (head === "evidenceIds") return "evidence";
  return head === "testedOn" || head === "result" || head === "method" || head === "notes"
    ? head
    : null;
}

const errorsFor = (paths: readonly string[]): Errors => {
  const errors: Errors = {};
  for (const path of paths) {
    const name = fieldOf(path);
    if (name) errors[name] = true;
  }
  return errors;
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

type Props = {
  code: string;
  evidenceOptions: ControlOperationDto["evidenceOptions"];
  /** The AI can suggest test steps (the operation's `canSuggestSteps`). */
  canSuggestSteps?: boolean;
};

/** Record a test: date, result, what was checked, notes and the evidence used. */
export function RecordTestForm({ code, evidenceOptions, canSuggestSteps = false }: Props) {
  const t = useTranslations("library.operation");
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [testedOn, setTestedOn] = useState(todayUtc);
  const [result, setResult] = useState<ControlTestResult | "">("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<FormError | "summary" | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [steps, setSteps] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const methodRef = useRef<HTMLTextAreaElement>(null);
  const [suggestError, setSuggestError] = useState<"unavailable" | "failed" | null>(null);

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setAnnouncement(t("suggest.announceWorking"));
    const result = await settle(() => suggestTestSteps(code));
    setSuggesting(false);
    if (result.ok) {
      setSteps(result.data.steps);
      setAnnouncement(t("suggest.announceDone"));
    } else if (!signInAgain(result)) {
      const ai =
        result.kind === "conflict" &&
        conflictReasons(result.details).some((r) => r.reason === "aiUnavailable");
      setAnnouncement("");
      setSuggestError(ai ? "unavailable" : "failed");
    }
  }

  /** Appends the numbered steps to what was checked; the person edits them from there. */
  function insertSteps() {
    if (!steps) return;
    const lines = steps.map((step, i) => `${String(i + 1)}. ${step}`).join("\n");
    setMethod((current) => (current.trim() === "" ? lines : `${current.trimEnd()}\n${lines}`));
    setSteps(null);
    setAnnouncement("");
    methodRef.current?.focus();
  }

  function showErrors(next: Errors) {
    setErrors(next);
    setFormError(Object.keys(next).length > 0 ? "summary" : "notAccepted");
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "saving") return;
    const parsed = RecordControlTestInput.safeParse({
      testedOn,
      result: result || undefined,
      method: method.trim(),
      notes: notes.trim(),
      evidenceIds,
    });
    if (!parsed.success) {
      showErrors(errorsFor(parsed.error.issues.map((i) => i.path.map(String).join("."))));
      return;
    }
    setErrors({});
    setFormError(null);
    setStatus("saving");
    let outcome: Awaited<ReturnType<typeof recordControlTest>>;
    try {
      outcome = await recordControlTest(code, parsed.data);
    } catch {
      outcome = { ok: false, kind: "unavailable", details: [] };
    }
    if (outcome.ok) {
      setStatus("saved");
      setResult("");
      setMethod("");
      setNotes("");
      setEvidenceIds([]);
      return;
    }
    setStatus("idle");
    if ((outcome.kind === "signed-out" || outcome.kind === "reauth") && outcome.href) {
      goTo(outcome.href);
    } else if (outcome.kind === "invalid") {
      showErrors(errorsFor(outcome.details.map((d) => d.path)));
    } else if (outcome.kind === "forbidden") setFormError("forbidden");
    else if (outcome.kind === "conflict") setFormError("notAccepted");
    else setFormError("unavailable");
  }

  const field = (name: FieldName, hint: boolean) => ({
    id: `${id}-${name}`,
    error: errors[name] ? t(`errors.${name}`) : undefined,
    a11y: fieldA11y(`${id}-${name}`, { hint, error: errors[name] }),
  });
  const date = field("testedOn", true);
  const what = field("method", true);
  const extra = field("notes", false);
  const resultError = errors.result ? t("errors.result") : undefined;
  const evidenceError = errors.evidence ? t("errors.evidence") : undefined;

  return (
    <form
      ref={formRef}
      noValidate
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => void onSubmit(e)}
      onChange={() => {
        setStatus((current) => (current === "saved" ? "idle" : current));
      }}
      className="flex max-w-[640px] flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-[15px] font-semibold text-fg">
          {t("form.title")}
        </h3>
        <p className="text-[13px] leading-relaxed text-fg-muted">{t("form.intro")}</p>
      </div>
      <Field
        id={date.id}
        label={t("form.testedOn")}
        hint={t("form.testedOnHint")}
        error={date.error}
      >
        <Input
          id={date.id}
          type="date"
          max={todayUtc()}
          value={testedOn}
          onValueChange={setTestedOn}
          className="sm:max-w-48"
          {...date.a11y}
        />
      </Field>
      <fieldset
        aria-labelledby={`${id}-result-legend`}
        aria-describedby={resultError ? `${id}-result-error` : undefined}
        className="flex flex-col gap-2"
      >
        <legend id={`${id}-result-legend`} className="mb-1 text-sm font-semibold text-fg">
          {t("form.result")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ControlTestResultSchema.options.map((option) => {
            const Icon = RESULT_ICON[option];
            return (
              <label key={option} className={cn(choiceCard, "items-center p-3")}>
                <input
                  type="radio"
                  name={`${id}-result`}
                  value={option}
                  checked={result === option}
                  aria-invalid={errors.result ? true : undefined}
                  onChange={() => {
                    setResult(option);
                  }}
                  className={choiceInput}
                />
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t(`results.${option}`)}
                </span>
              </label>
            );
          })}
        </div>
        {resultError ? (
          <p
            id={`${id}-result-error`}
            className="flex items-start gap-1.5 text-[13px] font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{resultError}</span>
          </p>
        ) : null}
      </fieldset>
      <Field id={what.id} label={t("form.method")} hint={t("form.methodHint")} error={what.error}>
        <Textarea
          id={what.id}
          ref={methodRef}
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
          }}
          {...what.a11y}
        />
      </Field>
      {canSuggestSteps ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            {announcement}
          </p>
          {steps ? (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-surface-border p-3.5">
              <AiBadge state="suggested" label={t("suggest.badge")} />
              <ol
                aria-label={t("suggest.listLabel")}
                className="list-decimal pl-5 text-sm leading-relaxed text-fg"
              >
                {steps.map((step, i) => (
                  // Steps may repeat word for word, and the list never reorders: key by position.
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="text-[13px] text-fg-muted">{t("suggest.note")}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={insertSteps}
              >
                {t("suggest.insert")}
              </Button>
            </div>
          ) : null}
          {suggestError ? (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-[13px] font-medium text-critical"
            >
              <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
              <span>{t(`suggest.${suggestError}`)}</span>
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            disabled={suggesting}
            focusableWhenDisabled
            onClick={() => void suggest()}
          >
            {suggesting ? t("suggest.working") : t("suggest.button")}
          </Button>
        </div>
      ) : null}
      <Field id={extra.id} label={t("form.notes")} error={extra.error}>
        <Textarea
          id={extra.id}
          rows={3}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
          {...extra.a11y}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-fg">{t("form.evidence")}</legend>
        {evidenceOptions.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{t("form.noEvidenceOptions")}</p>
        ) : (
          evidenceOptions.map((option) => (
            <label key={option.id} className="flex items-start gap-2.5 text-sm text-fg">
              <input
                type="checkbox"
                value={option.id}
                checked={evidenceIds.includes(option.id)}
                onChange={(e) => {
                  setEvidenceIds((ids) =>
                    e.target.checked ? [...ids, option.id] : ids.filter((x) => x !== option.id),
                  );
                }}
                className={choiceInput}
              />
              <span>
                {t("form.evidenceOption", {
                  fileName: option.fileName,
                  riskReference: option.riskReference,
                })}
              </span>
            </label>
          ))
        )}
        {evidenceError ? (
          <p className="flex items-start gap-1.5 text-[13px] font-medium text-critical">
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{evidenceError}</span>
          </p>
        ) : null}
      </fieldset>
      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
        >
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          <span>{t(`errors.${formError}`)}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={status === "saving"} focusableWhenDisabled>
          {status === "saving" ? t("form.saving") : t("form.submit")}
        </Button>
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          {status === "saved" ? (
            <>
              <CircleCheckIcon aria-hidden className="size-4 text-ok" />
              {t("form.saved")}
            </>
          ) : null}
        </p>
      </div>
    </form>
  );
}
