"use client";

import type { RiskSummaryDto } from "@isms/contracts";
import { cn, StatusBadge } from "@isms/ui";
import {
  ArchiveIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

/** Each state in words with its own icon; colour is never the only signal. */
const STATE: Record<RiskSummaryDto["state"], { icon: LucideIcon; tone: string }> = {
  proposed: { icon: HourglassIcon, tone: "bg-info-soft text-info" },
  in_review: { icon: ClipboardCheckIcon, tone: "bg-accent-soft text-accent" },
  approved: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
  returned: { icon: RotateCcwIcon, tone: "bg-attention-soft text-attention" },
  // A closed risk is "Treated": dealt with, and still on record.
  closed: { icon: ArchiveIcon, tone: "bg-ok-soft text-ok" },
};

export function RiskStateBadge({ state }: { state: RiskSummaryDto["state"] }) {
  const t = useTranslations("risks.state");
  const { icon: Icon, tone } = STATE[state];
  return (
    <span
      data-risk-state={state}
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{t(state)}</span>
    </span>
  );
}

/**
 * The API's score and appetite status, in words: "Score 12" (or "12 out of 25" with `outOf`)
 * and "Above appetite".
 */
export function ScoreBadges({
  score,
  aboveAppetite,
  outOf = false,
}: Pick<RiskSummaryDto, "score" | "aboveAppetite"> & { outOf?: boolean }) {
  const t = useTranslations("risks.score");
  if (score === null) return <StatusBadge status="unknown" label={t("unscored")} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-fg tabular-nums">
        {t(outOf ? "outOf" : "value", { score })}
      </span>
      {aboveAppetite ? (
        <StatusBadge status="aboveAppetite" label={t("aboveAppetite")} />
      ) : (
        <StatusBadge status="ok" label={t("withinAppetite")} />
      )}
    </span>
  );
}
