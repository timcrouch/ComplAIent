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
  Input,
} from "@isms/ui";
import { conflictReasons } from "@isms/contracts";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type SubmitEvent } from "react";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";

export type DemoMode = "load" | "reset";

type Failure = Exclude<CallResult<unknown>, { ok: true }>;
type ErrorKey = "confirmationMismatch" | "recentAuth" | "forbidden" | "unavailable";

/** The API's own text is never shown; the message comes from the message file. */
function errorKey(result: Failure): ErrorKey {
  if (result.kind === "reauth" || result.kind === "signed-out") return "recentAuth";
  if (result.kind === "forbidden") return "forbidden";
  if (conflictReasons(result.details).some((c) => c.reason === "confirmationMismatch")) {
    return "confirmationMismatch";
  }
  return "unavailable";
}

type Props = {
  mode: DemoMode;
  /** The organisation name, or `RESET` when none is set up yet. */
  expected: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the action. On success the server redirects, so a returned result is a refusal. */
  run: (confirm: string) => Promise<CallResult<unknown>>;
};

/**
 * Says what will be deleted and asks for the organisation name (or RESET). The button stays
 * disabled until the trimmed text equals it exactly (case-sensitive); the server checks too.
 */
export function DemoConfirmDialog({ mode, expected, open, onOpenChange, run }: Props) {
  const t = useTranslations("setup.demo");
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const isReset = expected === "RESET";
  const matches = value.trim() === expected;
  const fieldId = `${id}-confirm`;
  const hint = isReset ? t("dialog.hintReset") : t("dialog.hintName", { expected });

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !matches) return;
    setBusy(true);
    setError(null);
    try {
      const result = await run(value);
      if (!result.ok) {
        setError(errorKey(result));
        if ((result.kind === "reauth" || result.kind === "signed-out") && result.href) {
          goTo(result.href);
        }
      }
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setValue("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t("dialog.cancel")} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(mode === "load" ? "dialog.loadTitle" : "dialog.resetTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.intro")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          aria-busy={busy}
          onSubmit={(e) => void onSubmit(e)}
          className="flex flex-col gap-4"
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
            {(t.raw("dialog.deletes") as string[]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-sm text-fg-muted">{t("dialog.after")}</p>
          <Field
            id={fieldId}
            label={isReset ? t("dialog.label.reset") : t("dialog.label.name")}
            hint={hint}
          >
            <Input
              id={fieldId}
              value={value}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              {...fieldA11y(fieldId, { hint: true, error: undefined })}
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
            >
              <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
              <span>{t(`errors.${error}`)}</span>
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
              {t("dialog.cancel")}
            </DialogClose>
            <Button type="submit" disabled={!matches || busy} focusableWhenDisabled>
              {busy ? t(mode === "load" ? "loading" : "resetting") : t(`${mode}.confirm`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
