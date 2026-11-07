"use client";

import type { AiKeyStatusDto, AiSettingsDto } from "@isms/contracts";
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
import { CircleCheckIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { removeAiKey, saveAiKey } from "../../lib/actions/ai-settings";
import { formatDate } from "../../lib/dates";
import { SettingsError, useSettingsCall } from "./settings-call";

type KeyFormProps = {
  keyStatus: AiKeyStatusDto;
  secretsKeyConfigured: boolean;
  /** The viewer's time zone, for the date the key was set. */
  timeZone: string;
  onSaved: (settings: AiSettingsDto) => void;
};

/**
 * The provider key, write-only: a password field that is emptied as soon as the key is
 * saved, and afterwards only its last 4 characters, who set it and when. Remove asks first.
 */
export function KeyForm({ keyStatus, secretsKeyConfigured, timeZone, onSaved }: KeyFormProps) {
  const t = useTranslations("settings.ai.key");
  const te = useTranslations("settings.ai.errors");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useSettingsCall();
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [announced, setAnnounced] = useState("");

  const editing = !keyStatus.set || replacing;
  const inputId = `${id}-key`;
  const invalidText = fieldError ? t("invalid") : undefined;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const key = value;
    setFieldError(false);
    setAnnounced("");
    const saved = await run(
      () => saveAiKey(key),
      (result) => {
        if (!result.details.some((d) => d.path === "key")) return false;
        setFieldError(true);
        inputRef.current?.focus();
        return true;
      },
    );
    if (!saved) return;
    // The key leaves this page: the field is emptied and only the returned status is kept.
    setValue("");
    setReplacing(false);
    setAnnounced(t("saved"));
    onSaved(saved);
  }

  async function remove() {
    setConfirming(false);
    setAnnounced("");
    const saved = await run(() => removeAiKey());
    if (!saved) return;
    setAnnounced(t("removed"));
    onSaved(saved);
  }

  return (
    <div className="flex flex-col gap-4">
      {!secretsKeyConfigured ? (
        <Notice>{te("secretsKeyMissing")}</Notice>
      ) : keyStatus.set && !keyStatus.readable ? (
        <Notice>{te("keyUnreadable")}</Notice>
      ) : null}

      {keyStatus.set ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm font-medium text-fg">
            <KeyRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
            <span>
              {t("status", {
                last4: keyStatus.last4,
                name: keyStatus.setBy.displayName,
                date: formatDate(keyStatus.setAt, timeZone),
              })}
            </span>
          </p>
          {replacing ? null : (
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setReplacing(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                {t("replace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                focusableWhenDisabled
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t("remove")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t("none")}</p>
      )}

      {editing ? (
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
          <Field id={inputId} label={t("label")} hint={t("hint")} error={invalidText}>
            <Input
              id={inputId}
              ref={inputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
              {...fieldA11y(inputId, { hint: true, error: invalidText })}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} focusableWhenDisabled>
              {busy ? t("saving") : t("save")}
            </Button>
            {replacing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReplacing(false);
                  setValue("");
                  setFieldError(false);
                }}
              >
                {t("cancelReplace")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <SettingsError error={error} />
      <p
        role="status"
        className="flex min-h-5 items-center gap-1.5 text-sm font-medium text-fg-muted"
      >
        {announced ? <CircleCheckIcon aria-hidden className="size-4 text-ok" /> : null}
        {announced}
      </p>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent closeLabel={t("confirmClose")} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("confirmCancel")}
            </DialogClose>
            <Button type="button" onClick={() => void remove()}>
              {t("confirmRemove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-attention-soft px-3.5 py-3 text-sm font-medium text-fg">
      <TriangleAlertIcon aria-hidden className="mt-px size-4 shrink-0 text-attention" />
      <span>{children}</span>
    </p>
  );
}
