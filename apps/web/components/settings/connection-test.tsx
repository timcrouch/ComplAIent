"use client";

import type { AiTestConnectionResponse } from "@isms/contracts";
import { Button } from "@isms/ui";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { testAiConnection } from "../../lib/actions/ai-settings";
import { SettingsError, useSettingsCall } from "./settings-call";

/**
 * Sends one harmless request with the saved key and settings. The outcome is announced in a
 * status region as a plain sentence, with an icon; the provider's own text is never shown.
 */
export function ConnectionTest() {
  const t = useTranslations("settings.ai.test");
  const { busy, error, run } = useSettingsCall();
  const [outcome, setOutcome] = useState<AiTestConnectionResponse | null>(null);

  async function test() {
    if (busy) return;
    setOutcome(null);
    setOutcome(await run(() => testAiConnection()));
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        focusableWhenDisabled
        className="w-full sm:w-fit"
        onClick={() => void test()}
      >
        {busy ? t("testing") : t("button")}
      </Button>
      <p
        role="status"
        className={
          outcome
            ? outcome.ok
              ? "flex items-start gap-2 text-sm font-medium text-fg"
              : "flex items-start gap-2 text-sm font-medium text-critical"
            : "min-h-5"
        }
      >
        {outcome ? (
          outcome.ok ? (
            <CircleCheckIcon aria-hidden className="mt-px size-4 shrink-0 text-ok" />
          ) : (
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          )
        ) : null}
        {outcome
          ? outcome.ok
            ? t("ok", { model: outcome.model })
            : t(`reasons.${outcome.reason}`)
          : null}
      </p>
      <SettingsError error={error} />
    </div>
  );
}
