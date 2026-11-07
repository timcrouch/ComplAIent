"use client";

import { SetApplicabilityInput, type SoaRowDto } from "@isms/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  fieldA11y,
  Textarea,
  type DialogContentProps,
} from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { setApplicability } from "../../lib/actions/reports";
import { goTo } from "../../lib/navigate";
import { choiceCard, choiceInput } from "../setup/styles";

type Props = {
  row: SoaRowDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a stale refusal's reload, and after a save; the page re-reads its data. */
  onChanged: () => void;
  finalFocus?: DialogContentProps["finalFocus"];
};

type Problem = "forbidden" | "unavailable" | "stale";

/**
 * Decide whether a requirement applies: a radio choice and a required justification (1-2000
 * characters). Focus starts on the first radio; a missing part is explained and focused; a
 * refusal is shown in the dialog, which stays open.
 */
export function ApplicabilityDialog({ row, open, onOpenChange, onChanged, finalFocus }: Props) {
  const t = useTranslations("reports.dialog");
  const id = useId();
  const firstRadio = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [choice, setChoice] = useState<boolean | null>(row.decision?.applicable ?? null);
  const [text, setText] = useState(row.decision?.justification ?? "");
  const [choiceMissing, setChoiceMissing] = useState(false);
  const [textMissing, setTextMissing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = SetApplicabilityInput.safeParse({
      applicable: choice ?? undefined,
      justification: text.trim(),
    });
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => String(i.path[0]));
      setChoiceMissing(paths.includes("applicable"));
      setTextMissing(paths.includes("justification"));
      if (paths.includes("applicable")) firstRadio.current?.focus();
      else textRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    let outcome: Awaited<ReturnType<typeof setApplicability>>;
    try {
      outcome = await setApplicability(row.requirementId, parsed.data);
    } catch {
      outcome = { ok: false, kind: "unavailable", details: [] };
    }
    setBusy(false);
    if (outcome.ok) {
      onChanged();
      onOpenChange(false);
      return;
    }
    if ((outcome.kind === "signed-out" || outcome.kind === "reauth") && outcome.href) {
      goTo(outcome.href);
    } else if (outcome.kind === "invalid") {
      setTextMissing(true);
      textRef.current?.focus();
    } else if (outcome.kind === "forbidden") setProblem("forbidden");
    else if (outcome.kind === "not-found" || outcome.kind === "conflict") setProblem("stale");
    else setProblem("unavailable");
  }

  const textId = `${id}-justification`;
  const textError = textMissing ? t("errors.justification") : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("close")}
        initialFocus={firstRadio}
        {...(finalFocus === undefined ? {} : { finalFocus })}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("title", { ref: row.ref })}</DialogTitle>
          <DialogDescription>{row.title}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <fieldset
            aria-describedby={choiceMissing ? `${id}-choice-error` : undefined}
            className="flex flex-col gap-2"
          >
            <legend className="mb-1 text-sm font-semibold text-fg">{t("applicability")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([true, false] as const).map((value) => (
                <label key={String(value)} className={`${choiceCard} items-center p-3`}>
                  <input
                    ref={value ? firstRadio : undefined}
                    type="radio"
                    name={`${id}-applicable`}
                    checked={choice === value}
                    aria-invalid={choiceMissing ? true : undefined}
                    onChange={() => {
                      setChoice(value);
                      setChoiceMissing(false);
                    }}
                    className={choiceInput}
                  />
                  <span className="text-sm font-semibold text-fg">
                    {t(value ? "applicable" : "notApplicable")}
                  </span>
                </label>
              ))}
            </div>
            {choiceMissing ? (
              <p
                id={`${id}-choice-error`}
                className="flex items-start gap-1.5 text-[13px] font-medium text-critical"
              >
                <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
                <span>{t("errors.choice")}</span>
              </p>
            ) : null}
          </fieldset>
          <Field
            id={textId}
            label={t("justification")}
            hint={t("justificationHint")}
            error={textError}
          >
            <Textarea
              id={textId}
              ref={textRef}
              rows={4}
              maxLength={2000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTextMissing(false);
              }}
              {...fieldA11y(textId, { hint: true, error: textError })}
            />
          </Field>
          <div role="status">
            {problem ? (
              <p className="flex items-start gap-1.5 text-[13px] leading-snug font-medium text-critical">
                <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
                <span>{t(`errors.${problem}`)}</span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("cancel")}
            </DialogClose>
            {problem === "stale" ? (
              <Button
                type="button"
                onClick={() => {
                  onChanged();
                  onOpenChange(false);
                }}
              >
                {t("errors.reload")}
              </Button>
            ) : (
              <Button type="submit" aria-disabled={busy || undefined}>
                {busy ? t("saving") : t("save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
