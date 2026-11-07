"use client";

import { conflictReasons, type OrganisationFrameworkDto } from "@isms/contracts";
import { Button } from "@isms/ui";
import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { suggestFrameworks } from "../../lib/actions/setup";
import { goTo } from "../../lib/navigate";
import { openSuggestions, type FrameworkSuggestion } from "../../lib/framework-suggestions";
import type { CallResult } from "../../lib/server-api";

type Message = "noneNew" | "unavailable" | "profileFirst" | "failed";
type Failure = Exclude<CallResult<unknown>, { ok: true }>;

function failureMessage(result: Failure): Message {
  const reason = result.kind === "conflict" ? conflictReasons(result.details)[0]?.reason : null;
  if (reason === "aiUnavailable") return "unavailable";
  if (reason === "setupIncomplete") return "profileFirst";
  return "failed";
}

/**
 * "Suggest from your answers": only rendered when the AI can run. The result is announced in
 * a status region; focus stays on the button, which never leaves the page.
 */
export function FrameworkSuggest({
  onSuggested,
}: {
  onSuggested: (suggestions: FrameworkSuggestion[]) => void;
}) {
  const t = useTranslations("setup.frameworks.suggest");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let result: CallResult<{ frameworks: OrganisationFrameworkDto[] }>;
    try {
      result = await suggestFrameworks();
    } catch {
      result = { ok: false, kind: "unavailable", details: [] };
    }
    setBusy(false);
    if (result.ok) {
      const suggestions = openSuggestions(result.data.frameworks);
      onSuggested(suggestions);
      setMessage(
        suggestions.length === 0 ? t("noneNew") : t("arrived", { count: suggestions.length }),
      );
      return;
    }
    if ((result.kind === "signed-out" || result.kind === "reauth") && result.href) {
      goTo(result.href);
      return;
    }
    setMessage(t(failureMessage(result)));
  }

  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_35%,transparent)] p-4">
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-fg-muted">{t("intro")}</p>
      <Button
        type="button"
        variant="secondary"
        aria-disabled={busy || undefined}
        onClick={() => void suggest()}
      >
        <SparklesIcon aria-hidden />
        {busy ? t("busy") : t("button")}
      </Button>
      <p
        role="status"
        data-testid="suggest-status"
        className={message ? "text-[13px] font-medium text-fg" : "sr-only"}
      >
        {message}
      </p>
    </div>
  );
}
