"use client";

import type { AiObligationDto, AiSystemSummaryDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleOffIcon,
  EyeIcon,
  HourglassIcon,
  CircleMinusIcon,
  PuzzleIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

type RiskClass = AiSystemSummaryDto["riskClass"];
type ObligationStatus = AiObligationDto["status"];

const pill =
  "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap";

/** Each class in words with its own icon; colour is never the only signal. */
const CLASS: Record<RiskClass, { icon: LucideIcon; tone: string }> = {
  unclassified: {
    icon: CircleDashedIcon,
    tone: "border border-dashed border-control-border bg-surface text-fg-muted",
  },
  out_of_scope: {
    icon: CircleOffIcon,
    tone: "bg-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] text-fg-muted",
  },
  prohibited: { icon: BanIcon, tone: "bg-critical-soft text-critical" },
  high_risk: { icon: TriangleAlertIcon, tone: "bg-attention-soft text-attention" },
  limited_risk: { icon: EyeIcon, tone: "bg-info-soft text-info" },
  minimal_risk: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
};

export function ClassBadge({ riskClass }: { riskClass: RiskClass }) {
  const t = useTranslations("aiAct.classes");
  const { icon: Icon, tone } = CLASS[riskClass];
  return (
    <span data-risk-class={riskClass} className={cn(pill, tone)}>
      <Icon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{t(riskClass)}</span>
    </span>
  );
}

const OBLIGATION: Record<ObligationStatus, { icon: LucideIcon; tone: string }> = {
  open: { icon: CircleDotIcon, tone: "bg-attention-soft text-attention" },
  in_progress: { icon: HourglassIcon, tone: "bg-info-soft text-info" },
  met: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
  not_applicable: {
    icon: CircleMinusIcon,
    tone: "bg-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] text-fg-muted",
  },
};

export function ObligationStatusBadge({ status }: { status: ObligationStatus }) {
  const t = useTranslations("aiAct.obligationStatuses");
  const { icon: Icon, tone } = OBLIGATION[status];
  return (
    <span data-obligation-status={status} className={cn(pill, tone)}>
      <Icon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{t(status)}</span>
    </span>
  );
}

/** "Module": the page belongs to an optional add-on, not to the core ISMS. */
export function ModuleBadge() {
  const t = useTranslations("aiAct");
  return (
    <span
      className={cn(
        pill,
        "border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_40%,transparent)] text-accent",
      )}
    >
      <PuzzleIcon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{t("moduleBadge")}</span>
    </span>
  );
}
