"use client";

import type { ControlDetailDto, ControlOperationDto, MappingDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Entrance } from "../motion/entrance";
import { glass } from "../setup/styles";
import { focusRingClass } from "../shell/styles";
import { ReviewSummaryBadge } from "./control-list";
import { ControlOperation } from "./control-operation";
import { MappingRow } from "./mapping-row";

type ControlDetailProps = {
  control: ControlDetailDto;
  canReview: boolean;
  timeZone: string;
  operation: ControlOperationDto | null;
};

type Group = { key: string; name: string; versionLabel: string; mappings: MappingDto[] };

/** Mappings grouped by framework version, in the API's order (version key, then requirement). */
function byFramework(mappings: readonly MappingDto[]): Group[] {
  const groups = new Map<string, Group>();
  for (const m of mappings) {
    const group = groups.get(m.frameworkVersionKey) ?? {
      key: m.frameworkVersionKey,
      name: m.frameworkName,
      versionLabel: m.versionLabel,
      mappings: [],
    };
    group.mappings.push(m);
    groups.set(m.frameworkVersionKey, group);
  }
  return [...groups.values()];
}

/** One control in full: our own wording, how to put it in place, and where it counts. */
export function ControlDetail({ control, canReview, timeZone, operation }: ControlDetailProps) {
  const t = useTranslations("library");
  // Rows report a new review here, so the summary badge stays true without a reload.
  const [mappings, setMappings] = useState(control.mappings);
  const groups = byFramework(mappings);
  const reviewed = mappings.filter((m) => m.review.status === "reviewed").length;
  const onReviewed = (stored: MappingDto) => {
    setMappings((current) => current.map((m) => (m.id === stored.id ? stored : m)));
  };

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <Link
          href="/library"
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline",
            focusRingClass,
          )}
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          {t("back")}
        </Link>
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-fg-muted">
          <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-xs tracking-wide text-accent">
            {control.code}
          </span>
          <span>{t(`categories.${control.category}`)}</span>
        </p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {control.title}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">
          {control.description}
        </p>
        <ReviewSummaryBadge mappings={{ total: mappings.length, reviewed }} />
      </Entrance>

      <Entrance order={1}>
        <ControlOperation operation={operation} timeZone={timeZone} />
      </Entrance>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Entrance order={1}>
          <section
            aria-labelledby="control-guidance"
            className={cn(glass, "flex flex-col gap-4 p-5 sm:p-6")}
          >
            <h2 id="control-guidance" className="text-lg font-bold tracking-[-0.01em] text-fg">
              {t("guidance")}
            </h2>
            <ol className="flex flex-col gap-3">
              {control.guidance.map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-sm leading-relaxed text-fg">
                  <span
                    aria-hidden
                    className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent"
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </Entrance>

        <Entrance order={2}>
          <section
            aria-labelledby="control-mappings"
            className={cn(glass, "relative flex flex-col gap-2 overflow-hidden p-5 sm:p-6")}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-28 -right-28 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--isms-accent)_12%,transparent),transparent)]"
            />
            <h2
              id="control-mappings"
              className="relative text-lg font-bold tracking-[-0.01em] text-fg"
            >
              {t("mappings")}
            </h2>
            <p className="relative max-w-[60ch] text-[13px] leading-relaxed text-fg-muted">
              {t("mappingsHint")}
            </p>
            {groups.map((group) => (
              <div key={group.key} className="relative mt-3">
                <h3 className="flex items-baseline gap-2 text-[15px] font-semibold text-fg">
                  {group.name}
                  <span className="text-[13px] font-medium text-fg-muted">
                    {group.versionLabel}
                  </span>
                </h3>
                <ul className="divide-y divide-[color-mix(in_oklab,var(--isms-text)_9%,transparent)]">
                  {group.mappings.map((m) => (
                    <MappingRow
                      key={m.id}
                      mapping={m}
                      canReview={canReview}
                      timeZone={timeZone}
                      onReviewed={onReviewed}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </Entrance>
      </div>
    </div>
  );
}
