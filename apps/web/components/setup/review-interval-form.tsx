"use client";

import { ReviewIntervalInput } from "@isms/contracts";
import { Button, Field, fieldA11y, Input } from "@isms/ui";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type SubmitEvent } from "react";
import { saveReviewInterval } from "../../lib/actions/setup";
import { goTo } from "../../lib/navigate";

/** "6" → 6; anything that is not a whole number is left for the schema to refuse. */
const monthsValue = (raw: string): unknown => (/^\d+$/.test(raw) ? Number(raw) : undefined);

/** How many months pass before an approved or treated risk comes back for review. */
export function ReviewIntervalForm({ months }: { months: number }) {
  const t = useTranslations("setup.reviewInterval");
  const id = `${useId()}-months`;
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [value, setValue] = useState(String(months));
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<"forbidden" | "unavailable" | "notAccepted" | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "saving") return;
    setMessage(null);
    const parsed = ReviewIntervalInput.safeParse({ months: monthsValue(value.trim()) });
    if (!parsed.success) {
      setInvalid(true);
      setStatus("idle");
      return;
    }
    setInvalid(false);
    setStatus("saving");
    let result: Awaited<ReturnType<typeof saveReviewInterval>>;
    try {
      result = await saveReviewInterval(parsed.data.months);
    } catch {
      result = { ok: false, kind: "unavailable", details: [] };
    }
    if (result.ok) {
      setStatus("saved");
      return;
    }
    setStatus("idle");
    if ((result.kind === "signed-out" || result.kind === "reauth") && result.href) {
      goTo(result.href);
    } else if (result.kind === "invalid") setInvalid(true);
    else if (result.kind === "conflict") setMessage("notAccepted");
    else if (result.kind === "forbidden") setMessage("forbidden");
    else setMessage("unavailable");
  }

  const error = invalid ? t("errors.months") : undefined;
  return (
    <form
      noValidate
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-[560px] flex-col gap-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-bold tracking-[-0.01em] text-fg">
        {t("title")}
      </h2>
      <Field id={id} label={t("label")} hint={t("hint")} error={error}>
        <Input
          id={id}
          inputMode="numeric"
          className="sm:max-w-40"
          value={value}
          onValueChange={(v) => {
            setValue(v);
            setStatus("idle");
          }}
          {...fieldA11y(id, { hint: true, error })}
        />
      </Field>
      {message ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
        >
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          <span>{t(`errors.${message}`)}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving"} focusableWhenDisabled>
          {status === "saving" ? t("saving") : t("save")}
        </Button>
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          {status === "saved" ? (
            <>
              <CircleCheckIcon aria-hidden className="size-4 text-ok" />
              {t("saved")}
            </>
          ) : null}
        </p>
      </div>
    </form>
  );
}
