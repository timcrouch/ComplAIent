"use client";

import type { ControlSummaryDto, FrameworkVersionDto } from "@isms/contracts";
import { cn, StatusBadge } from "@isms/ui";
import { ArrowRightIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";
import { glass } from "../setup/styles";
import { TestResultBadge } from "./test-result";

type ControlListProps = {
  items: readonly ControlSummaryDto[];
  /** Every framework version in the library, for the names shown on each card. */
  frameworks: readonly FrameworkVersionDto[];
  /** The size of the whole library, when a search or filter narrows the list. */
  total?: number | undefined;
};

type Summary = ControlSummaryDto["mappings"];

/**
 * The review badge for a card. A control with no mappings is not "all reviewed": nobody has
 * checked anything, so it says so (the API counts an empty set as reviewed).
 */
export function ReviewSummaryBadge({ mappings }: { mappings: Summary }) {
  const t = useTranslations("library");
  if (mappings.total === 0) return <StatusBadge status="unknown" label={t("noMappings")} />;
  if (mappings.reviewed === mappings.total) {
    return <StatusBadge status="ok" label={t("allReviewed")} />;
  }
  return (
    <StatusBadge
      status="attention"
      label={t("someReviewed", { reviewed: mappings.reviewed, total: mappings.total })}
    />
  );
}

/** A thin meter of reviewed mappings. Decoration only: the badge says the same in words. */
function ReviewMeter({ mappings }: { mappings: Summary }) {
  if (mappings.total === 0) return null;
  const share = Math.round((mappings.reviewed / mappings.total) * 100);
  return (
    <span
      aria-hidden
      className="block h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--isms-text)_9%,transparent)]"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          share === 100
            ? "bg-ok"
            : "bg-[color-mix(in_oklab,var(--isms-attention)_80%,transparent)]",
        )}
        style={{ width: `${String(share)}%` }}
      />
    </span>
  );
}

/** Search results as cards: code, title, frameworks and how much of the mapping is reviewed. */
export function ControlList({ items, frameworks, total }: ControlListProps) {
  const t = useTranslations("library");
  const nameOf = (key: string) => frameworks.find((f) => f.key === key)?.name ?? key;

  return (
    <div className="flex flex-col gap-4">
      {/* A polite live region: the new count is announced after each filter or search. */}
      <p role="status" className="text-sm font-semibold text-fg-muted">
        {total === undefined
          ? t("results", { count: items.length })
          : t("resultsOf", { count: items.length, total })}
      </p>
      {items.length === 0 ? (
        <div className={cn(glass, "flex flex-col items-start gap-3 p-6 sm:p-8")}>
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-info-soft text-info">
            <SearchXIcon aria-hidden className="size-5" />
          </span>
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-fg">{t("empty")}</p>
          <Link
            href="/library"
            className={cn(
              "text-sm font-semibold text-accent underline-offset-4 hover:underline",
              focusRingClass,
              "rounded-xs",
            )}
          >
            {t("clear")}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((control) => (
            <li
              key={control.code}
              className={cn(
                glass,
                "group relative flex flex-col gap-3 p-4 sm:p-5",
                "transition-[border-color,box-shadow,translate] duration-(--motion-fast) ease-standard",
                "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--isms-accent)_40%,transparent)] motion-reduce:hover:translate-y-0",
                "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-bg",
              )}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-fg-muted">
                <span>{t(`categories.${control.category}`)}</span>
                <ArrowRightIcon
                  aria-hidden
                  className="size-4 text-accent opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100"
                />
              </div>
              <h2 className="text-[15px] leading-snug font-semibold text-fg">
                {/* The whole card is the link (stretched); the accessible name is code + title. */}
                <Link
                  href={`/library/${control.code}`}
                  className="flex flex-col gap-1.5 outline-none after:absolute after:inset-0 after:rounded-lg"
                >
                  <span className="w-fit rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide text-accent">
                    {control.code}
                  </span>{" "}
                  <span>{control.title}</span>
                </Link>
              </h2>
              {control.frameworks.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {control.frameworks.map((key) => (
                    <li
                      key={key}
                      className="rounded-full border border-control-border px-2 py-0.5 text-xs font-medium text-fg-muted"
                    >
                      {nameOf(key)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-auto flex flex-col gap-2 pt-1">
                <ReviewMeter mappings={control.mappings} />
                <ReviewSummaryBadge mappings={control.mappings} />
                {control.latestResult ? (
                  <TestResultBadge result={control.latestResult} />
                ) : control.inUse ? (
                  <StatusBadge status="unknown" label={t("operation.notTestedYet")} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
