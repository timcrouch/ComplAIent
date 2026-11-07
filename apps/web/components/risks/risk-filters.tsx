"use client";

import { RiskListFilterSchema, type RiskListFilter } from "@isms/contracts";
import { cn } from "@isms/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";

/** The queue's filters (RiskListQuery.filter) as links; the current one is marked. */
export function RiskFilters({
  current,
  cell,
}: {
  current: RiskListFilter;
  /** Kept in every link while a map cell narrows the list. */
  cell?:
    | { likelihood: number; impact: number; basis: string; includeClosed?: boolean | undefined }
    | undefined;
}) {
  const t = useTranslations("risks.filters");
  return (
    <nav aria-label={t("label")}>
      <ul className="flex flex-wrap gap-2">
        {RiskListFilterSchema.options
          .filter((filter) => filter !== "noExpectedScore" || current === "noExpectedScore")
          .map((filter) => {
            const active = filter === current;
            return (
              <li key={filter}>
                <Link
                  href={
                    cell
                      ? `/risks?filter=${filter}&likelihood=${String(cell.likelihood)}&impact=${String(cell.impact)}&basis=${cell.basis}${cell.includeClosed ? "&includeClosed=true" : ""}`
                      : `/risks?filter=${filter}`
                  }
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap",
                    active
                      ? "border-accent bg-accent-soft text-accent shadow-[0_0_0_1px_var(--isms-accent)]"
                      : "border-surface-border bg-surface text-fg hover:bg-[color-mix(in_oklab,var(--isms-surface),var(--isms-text)_5%)]",
                    focusRingClass,
                  )}
                >
                  {t(filter)}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
