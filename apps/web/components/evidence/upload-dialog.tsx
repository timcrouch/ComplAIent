"use client";

import type { EvidenceDto } from "@isms/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  fieldA11y,
  Input,
  Select,
  type DialogContentProps,
} from "@isms/ui";
import { UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { goTo } from "../../lib/navigate";
import { ProblemText } from "../risks/notices";
import { choiceInput } from "../setup/styles";
import { sendUpload } from "./upload-call";
import { FILE_ERRORS, formatBytes, uploadErrorKey, type EvidenceErrorKey } from "./upload-errors";

export type ControlChoice = { controlId: string; code: string; title: string };

const CLASSIFICATIONS = ["internal", "confidential", "restricted"] as const;

type UploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The BFF upload route. */
  url: string;
  /** The accepted controls to choose from; null for a task, whose control is already set. */
  controls: readonly ControlChoice[] | null;
  /** The size limit, checked here first; the BFF and the API check it again. */
  maxBytes: number;
  onUploaded: (evidence: EvidenceDto) => void;
  finalFocus?: DialogContentProps["finalFocus"];
};

/**
 * Upload one evidence file: the file, then (on a risk) the accepted controls it supports and
 * when it was collected, and its classification. Errors are named in words next to their field;
 * a refusal from the server is said in the dialog's status line.
 */
export function UploadDialog(props: UploadDialogProps) {
  const { open, onOpenChange, title, description, url, controls, maxBytes, onUploaded } = props;
  const t = useTranslations("evidence");
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<EvidenceErrorKey | null>(null);
  const [controlsError, setControlsError] = useState(false);
  const [error, setError] = useState<EvidenceErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const size = formatBytes(maxBytes);
  const message = (key: EvidenceErrorKey) => t(`errors.${key}`, { size });

  /** The first problem the form can see by itself, or null. */
  function check(form: HTMLFormElement): boolean {
    const file = fileRef.current?.files?.[0];
    const fileProblem: EvidenceErrorKey | null = !file
      ? "fileRequired"
      : file.size === 0
        ? "empty"
        : file.size > maxBytes
          ? "tooLarge"
          : null;
    const noControls = controls !== null && new FormData(form).getAll("controlIds").length === 0;
    setFileError(fileProblem);
    setControlsError(noControls);
    if (fileProblem) fileRef.current?.focus();
    else if (noControls) controlsRef.current?.focus();
    return !fileProblem && !noControls;
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const form = event.currentTarget;
    if (!check(form)) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    // Fields first and the file last: the server reads the fields before streaming the file.
    const data = new FormData();
    const entered = new FormData(form);
    const text = (name: string) => {
      const entry = entered.get(name);
      return typeof entry === "string" ? entry : "";
    };
    data.set("classification", text("classification") || "internal");
    const collectedAt = text("collectedAt");
    if (controls !== null && collectedAt) data.set("collectedAt", collectedAt);
    for (const controlId of entered.getAll("controlIds"))
      if (typeof controlId === "string") data.append("controlIds", controlId);
    data.set("file", file);
    setBusy(true);
    try {
      const result = await sendUpload(url, data);
      if (result.ok) {
        onUploaded(result.data);
        return;
      }
      const key = uploadErrorKey(result);
      if (key === null) {
        if (result.href) goTo(result.href);
        return;
      }
      if (FILE_ERRORS.has(key)) {
        setFileError(key);
        fileRef.current?.focus();
      } else setError(key);
    } finally {
      setBusy(false);
    }
  }

  const fileId = `${id}-file`;
  const fileHint = t("uploadDialog.fileHint", { size });
  const fileMessage = fileError ? message(fileError) : undefined;
  const controlsErrorId = `${id}-controls-error`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("uploadDialog.cancel")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        {...(props.finalFocus === undefined ? {} : { finalFocus: props.finalFocus })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <Field id={fileId} label={t("uploadDialog.file")} hint={fileHint} error={fileMessage}>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              name="file"
              onChange={() => {
                setFileError(null);
              }}
              className="min-h-10 text-sm text-fg file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-md file:border file:border-surface-border file:bg-surface file:px-3 file:font-semibold file:text-fg"
              {...fieldA11y(fileId, { hint: fileHint, error: fileMessage })}
            />
          </Field>
          {controls === null ? null : (
            <fieldset
              className="flex flex-col gap-2"
              {...(controlsError ? { "aria-describedby": controlsErrorId } : {})}
            >
              <legend className="mb-1 text-sm font-semibold text-fg">
                {t("uploadDialog.controls")}
              </legend>
              {controls.map((c, index) => (
                <label key={c.controlId} className="flex min-h-6 items-start gap-2.5 text-sm">
                  <input
                    ref={index === 0 ? controlsRef : undefined}
                    type="checkbox"
                    name="controlIds"
                    value={c.controlId}
                    onChange={() => {
                      setControlsError(false);
                    }}
                    className={choiceInput}
                  />
                  <span>
                    <span className="font-semibold tabular-nums">{c.code}</span> {c.title}
                  </span>
                </label>
              ))}
              {controlsError ? (
                <ProblemText id={controlsErrorId}>{message("controlsRequired")}</ProblemText>
              ) : null}
            </fieldset>
          )}
          <div className={cn("grid gap-4", controls !== null && "sm:grid-cols-2")}>
            <Field id={`${id}-classification`} label={t("uploadDialog.classification")}>
              <Select id={`${id}-classification`} name="classification" defaultValue="internal">
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`classification.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {controls === null ? null : (
              <Field
                id={`${id}-collected`}
                label={t("uploadDialog.collectedAt")}
                hint={t("uploadDialog.collectedHint")}
              >
                <Input
                  id={`${id}-collected`}
                  type="date"
                  name="collectedAt"
                  {...fieldA11y(`${id}-collected`, { hint: true, error: false })}
                />
              </Field>
            )}
          </div>
          {/* Present before it is filled, so a refusal is announced. */}
          <div role="status">{error ? <ProblemText>{message(error)}</ProblemText> : null}</div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("uploadDialog.cancel")}
            </DialogClose>
            <Button type="submit" aria-disabled={busy || undefined}>
              <UploadIcon aria-hidden />
              {busy ? t("uploadDialog.uploading") : t("uploadDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
