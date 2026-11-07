"use client";

import { Button } from "@isms/ui";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { RiskErrorKey } from "./risk-call";

/** A refused change, in words with an icon (never colour alone). */
export function ErrorText({ id, error }: { id?: string; error: RiskErrorKey }) {
  const text = useErrorText();
  return <ProblemText id={id}>{text(error)}</ProblemText>;
}

/** The plain message for a refused change; residual refusals have their own copy. */
export function useErrorText(): (error: RiskErrorKey) => string {
  const t = useTranslations("risks.errors");
  const ti = useTranslations("insights.residual");
  return (error) => (error === "residual" ? ti("notWorse") : t(error));
}

/** A problem in words with an icon. */
export function ProblemText({ id, children }: { id?: string | undefined; children: string }) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-[13px] leading-snug font-medium text-critical"
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Shown where a change was refused because someone else saved the risk first. An alert, so
 * it is heard at once; the reload button re-reads the risk in place.
 */
export function StaleNotice({ onReload }: { onReload: () => Promise<boolean> }) {
  const t = useTranslations("risks.stale");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reload() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setFailed(!(await onReload()));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-[color-mix(in_oklab,var(--isms-attention)_40%,transparent)] bg-attention-soft p-3"
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-1.5 text-[13px] leading-snug font-semibold text-fg">
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0 text-attention" />
          <span>{t("message")}</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-disabled={busy || undefined}
          onClick={() => void reload()}
        >
          <RefreshCwIcon aria-hidden />
          {t("reload")}
        </Button>
      </div>
      {/* Present before it is filled, so the failure is announced. */}
      <p role="status" className="text-[13px] font-medium text-fg">
        {failed ? t("reloadFailed") : ""}
      </p>
    </div>
  );
}
