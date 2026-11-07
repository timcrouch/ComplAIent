"use client";

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
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { ProblemText, StaleNotice } from "./notices";

/** What the caller made of the note: done, someone else saved first, or a plain refusal. */
export type NoteResult =
  { ok: true } | { ok: false; stale: true } | { ok: false; stale?: false; message: string };

type NoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  submitLabel: string;
  /** A required note must not be blank; an optional one may be sent empty. */
  required: boolean;
  submit: (note: string) => Promise<NoteResult>;
  /** Re-reads what the dialog acts on after a stale refusal; true when it did. */
  onReload?: () => Promise<boolean>;
  finalFocus?: DialogContentProps["finalFocus"];
};

/**
 * A small dialog asking for one note or reason (1-2000 characters, or optional). Focus starts
 * in the field, a missing note is explained and linked to it, and a refusal is shown in the
 * dialog, which stays open. The caller closes it when `submit` says ok.
 */
export function NoteDialog(props: NoteDialogProps) {
  const { open, onOpenChange, title, description, label, submitLabel, required, submit } = props;
  const t = useTranslations("insights.noteDialog");
  const id = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const entry = new FormData(event.currentTarget).get("note");
    const note = typeof entry === "string" ? entry.trim() : "";
    if (required && note === "") {
      setMissing(true);
      fieldRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    setStale(false);
    const result = await submit(note);
    setBusy(false);
    if (result.ok) return;
    if (result.stale) setStale(true);
    else setProblem(result.message);
  }

  const fieldId = `${id}-note`;
  const error = missing ? t("required") : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("cancel")}
        initialFocus={fieldRef}
        {...(props.finalFocus === undefined ? {} : { finalFocus: props.finalFocus })}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <Field id={fieldId} label={label} error={error}>
            <Textarea
              id={fieldId}
              ref={fieldRef}
              name="note"
              maxLength={2000}
              onChange={() => {
                setMissing(false);
              }}
              {...fieldA11y(fieldId, { hint: false, error })}
            />
          </Field>
          <div role="status">{problem ? <ProblemText>{problem}</ProblemText> : null}</div>
          {stale && props.onReload ? <StaleNotice onReload={props.onReload} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("cancel")}
            </DialogClose>
            <Button type="submit" aria-disabled={busy || undefined}>
              {busy ? t("saving") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
