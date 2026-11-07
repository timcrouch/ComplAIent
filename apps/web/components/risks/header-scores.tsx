"use client";

import { ABOVE_APPETITE_TEXT, AboveAppetiteIcon, cn } from "@isms/ui";
import { CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRisk } from "./risk-context";

/** One score with its appetite status in words and an icon (colour is never the only signal). */
function ScorePart({ text, above }: { text: string; above: boolean }) {
  const t = useTranslations("insights.header");
  const Icon = above ? AboveAppetiteIcon : CircleCheckIcon;
  return (
    <span
      data-above-appetite={above}
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg"
    >
      <Icon
        aria-hidden
        strokeWidth={2.5}
        className={cn("size-3.5", above ? ABOVE_APPETITE_TEXT : "text-ok")}
      />
      <span className="tabular-nums">{text}</span>
      <span className="font-normal text-fg-muted">{above ? t("above") : t("within")}</span>
    </span>
  );
}

/** "Now 16 · Expected 4", or "Accepted at 16" when the risk is accepted. Display only. */
export function HeaderScores() {
  const t = useTranslations("insights.header");
  const { risk } = useRisk();
  if (risk.score === null) return null;
  const now = { score: risk.score, above: risk.aboveAppetite === true };
  if (risk.treatment === "accept") {
    return (
      <div data-testid="header-scores" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ScorePart text={t("accepted", { score: now.score })} above={now.above} />
      </div>
    );
  }
  return (
    <div data-testid="header-scores" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <ScorePart text={t("now", { score: now.score })} above={now.above} />
      {risk.residualScore !== null ? (
        <ScorePart
          text={t("expected", { score: risk.residualScore })}
          above={risk.residualAboveAppetite === true}
        />
      ) : null}
    </div>
  );
}
