"use client";

import { cn } from "@isms/ui";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode, Ref } from "react";
import { focusRingClass } from "../shell/styles";
import { ModuleBadge } from "./badges";

export const backLinkClass = cn(
  "inline-flex min-h-6 w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline",
  focusRingClass,
);

type Props = {
  title: string;
  intro?: string | undefined;
  /** Where "back" goes, and its words; none on the overview. */
  back?: { href: string; label: string } | undefined;
  /** Beside the eyebrow, such as the class and status of a system. */
  badges?: ReactNode;
  /** Buttons at the end of the heading row, such as "Add AI system". */
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
};

/**
 * The heading of every EU AI Act page. "EU AI Act" and a "Module" badge say this is an
 * optional add-on, not part of the core ISMS.
 */
export function ModuleHeader({ title, intro, back, badges, actions, headingRef }: Props) {
  const t = useTranslations("aiAct");
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link href={back.href} className={backLinkClass}>
          <ArrowLeftIcon aria-hidden className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <ModuleBadge />
        {badges}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] break-words text-fg outline-none sm:text-[34px]"
        >
          {title}
        </h1>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {intro ? (
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{intro}</p>
      ) : null}
    </header>
  );
}
