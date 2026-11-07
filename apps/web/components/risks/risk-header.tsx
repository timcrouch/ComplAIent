"use client";

import { AiBadge, cn } from "@isms/ui";
import { ArrowLeftIcon, MessagesSquareIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";
import { HeaderScores } from "./header-scores";
import { RiskStateBadge } from "./risk-badges";
import { useRisk } from "./risk-context";

const linkClass = cn(
  "inline-flex min-h-6 w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline",
  focusRingClass,
);

/** Reference, title, state and version, and how the risk was reported. */
export function RiskHeader() {
  const t = useTranslations("risks.header");
  const { risk } = useRisk();
  return (
    <header data-testid="risk-header" className="flex flex-col gap-3">
      <Link href="/risks" className={linkClass}>
        <ArrowLeftIcon aria-hidden className="size-4" />
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-fg-muted tabular-nums">
          {risk.reference}
        </span>
        <RiskStateBadge state={risk.state} />
        <span className="text-[13px] text-fg-muted tabular-nums">
          {t("version", { version: risk.version })}
        </span>
        {risk.aiAssisted ? <AiBadge state="draft" label={t("aiAssisted")} /> : null}
      </div>
      <h1
        id="risk-title"
        tabIndex={-1}
        className="text-[26px] leading-[1.2] font-bold tracking-[-0.025em] break-words text-fg outline-none sm:text-[32px]"
      >
        {risk.title}
      </h1>
      <HeaderScores />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-muted">
        <span>{t("reportedBy", { name: risk.reporter.displayName })}</span>
        {risk.can.readTranscript && risk.hasTranscript ? (
          <Link href={`/risks/${risk.id}/conversation`} className={linkClass}>
            <MessagesSquareIcon aria-hidden className="size-4" />
            {t("conversation")}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
