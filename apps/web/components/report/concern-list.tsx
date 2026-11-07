"use client";

import type { MyConcernsResponse } from "@isms/contracts";
import { buttonVariants, cn } from "@isms/ui";
import {
  ArrowRightIcon,
  ArchiveIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  HourglassIcon,
  RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";

type Concern = MyConcernsResponse["items"][number];

/** Each state in words with its own icon; colour is never the only signal. */
const STATUS: Record<Concern["state"], { icon: LucideIcon; tone: string }> = {
  proposed: { icon: HourglassIcon, tone: "bg-info-soft text-info" },
  in_review: { icon: ClipboardCheckIcon, tone: "bg-accent-soft text-accent" },
  approved: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
  returned: { icon: RotateCcwIcon, tone: "bg-attention-soft text-attention" },
  // A closed risk is "Treated": dealt with, and still on record.
  closed: { icon: ArchiveIcon, tone: "bg-ok-soft text-ok" },
};

const glass = "rounded-lg border border-surface-border bg-surface shadow-glass";

/** The reporter's concerns, newest first, with where each one stands in plain words. */
export function ConcernList({ items, timeZone }: { items: readonly Concern[]; timeZone: string }) {
  const t = useTranslations("concerns");
  if (items.length === 0) {
    return (
      <div className={cn(glass, "flex flex-col items-start gap-4 p-6 sm:p-8")}>
        <p className="text-[15px] leading-relaxed text-fg">{t("empty")}</p>
        <Link href="/report" className={buttonVariants({ variant: "primary" })}>
          {t("reportFirst")}
          <ArrowRightIcon aria-hidden />
        </Link>
      </div>
    );
  }
  return (
    <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
      {items.map((c) => (
        <li
          key={c.id}
          className={cn(
            glass,
            "flex flex-col gap-2 rounded-md p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-[12px] font-semibold text-fg-muted tabular-nums">{c.reference}</p>
            <p className="text-[15px] font-semibold break-words text-fg">{c.title}</p>
            <p className="text-[13px] text-fg-muted">
              {t("updated", { date: formatDate(c.updatedAt, timeZone) })}
            </p>
          </div>
          <ConcernStatus state={c.state} />
        </li>
      ))}
    </ul>
  );
}

/** Where a concern stands, in words with its own icon. */
export function ConcernStatus({ state }: { state: Concern["state"] }) {
  const t = useTranslations("concerns");
  const { icon: Icon, tone } = STATUS[state];
  return (
    <span
      data-concern-status={state}
      className={cn(
        "inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden strokeWidth={2.25} className="size-4 shrink-0" />
      <span>{t(`status.${state}`)}</span>
    </span>
  );
}
