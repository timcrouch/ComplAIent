"use client";

import type { ControlListQuery, FrameworkVersionDto } from "@isms/contracts";
import { CONTROL_CATEGORIES } from "@isms/domain";
import { cn, Select } from "@isms/ui";
import { XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MouseEvent, ReactNode } from "react";
import { activeFilters, libraryHref, type LibraryFilter } from "../../lib/library-url";
import { focusRingClass } from "../shell/styles";

type FilterBarProps = {
  frameworks: readonly FrameworkVersionDto[];
  /** The filters as last chosen, and the search as typed (for the chip and clear links). */
  query: Partial<ControlListQuery>;
  /** The search form the selects submit with, when scripts are off. */
  formId: string;
  /** The id of the select for a filter, so focus can return to it. */
  fieldId: (filter: LibraryFilter) => string;
  onChange: (filter: LibraryFilter, value: string) => void;
  onRemove: (filter: LibraryFilter) => void;
  onClear: () => void;
};

const REVIEW_OPTIONS = [
  ["all", "reviewAll"],
  ["unreviewed", "reviewUnreviewed"],
  ["reviewed", "reviewReviewed"],
] as const;
const IN_USE_OPTIONS = [
  ["true", "inUseYes"],
  ["false", "inUseNo"],
] as const;

const LABELS = {
  framework: "framework",
  review: "review",
  category: "category",
  inUse: "inUse",
} as const satisfies Record<LibraryFilter, string>;

const labelClass = "text-[13px] font-semibold text-fg";
const pillLink = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full text-[13px] font-medium",
  "transition-colors duration-(--motion-fast) ease-standard",
  focusRingClass,
);

/** Runs the handler with scripts on; without them the link itself navigates. */
const intercept = (run: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  run();
};

/**
 * The page filters above the list: four native selects, then the active filters as chips that
 * each remove one filter, and "Clear filters". Native selects commit on `change`, so moving
 * through options with the keyboard inside an open picker applies only the final choice.
 */
export function FilterBar({
  frameworks,
  query,
  formId,
  fieldId,
  onChange,
  onRemove,
  onClear,
}: FilterBarProps) {
  const t = useTranslations("library");
  const active = activeFilters(query);
  const headingId = `${formId}-filters`;
  const hintId = `${formId}-filters-hint`;

  const valueLabel = (filter: LibraryFilter): string => {
    const value = query[filter] ?? "";
    switch (filter) {
      case "framework": {
        const f = frameworks.find((x) => x.key === value);
        return f ? `${f.name} ${f.versionLabel}` : value;
      }
      case "review":
        return t(REVIEW_OPTIONS.find(([v]) => v === value)?.[1] ?? "reviewAll");
      case "category":
        return t(`categories.${value as (typeof CONTROL_CATEGORIES)[number]}`);
      case "inUse":
        return t(IN_USE_OPTIONS.find(([v]) => v === value)?.[1] ?? "inUseAny");
    }
  };

  const select = (filter: LibraryFilter, children: ReactNode, fallback = "") => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId(filter)} className={labelClass}>
        {t(LABELS[filter])}
      </label>
      <Select
        id={fieldId(filter)}
        name={filter}
        form={formId}
        value={query[filter] ?? fallback}
        onChange={(e) => {
          onChange(filter, e.target.value);
        }}
      >
        {children}
      </Select>
    </div>
  );

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      aria-describedby={hintId}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-[15px] font-semibold text-fg">
          {t("filters")}
        </h2>
        <p id={hintId} className="text-[13px] leading-snug text-fg-muted">
          {t("filtersHint")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select(
          "framework",
          <>
            <option value="">{t("anyFramework")}</option>
            {frameworks.map((f) => (
              <option key={f.key} value={f.key}>
                {`${f.name} ${f.versionLabel}`}
              </option>
            ))}
          </>,
        )}
        {select(
          "review",
          REVIEW_OPTIONS.map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          )),
          "all",
        )}
        {select(
          "category",
          <>
            <option value="">{t("anyCategory")}</option>
            {CONTROL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </>,
        )}
        {select(
          "inUse",
          <>
            <option value="">{t("inUseAny")}</option>
            {IN_USE_OPTIONS.map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </>,
        )}
      </div>
      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label={t("activeFilters")} className="flex flex-wrap gap-2">
            {active.map((filter) => {
              const label = t("activeFilter", {
                filter: t(LABELS[filter]),
                value: valueLabel(filter),
              });
              return (
                <li key={filter}>
                  <Link
                    href={libraryHref({ ...query, [filter]: undefined })}
                    scroll={false}
                    aria-label={t("removeFilter", { filter: label })}
                    onClick={intercept(() => {
                      onRemove(filter);
                    })}
                    className={cn(
                      pillLink,
                      "border border-accent bg-accent-soft pr-2 pl-3 text-accent",
                      "hover:bg-[color-mix(in_oklab,var(--isms-accent-soft),var(--isms-accent)_12%)]",
                    )}
                  >
                    {label}
                    <XIcon aria-hidden strokeWidth={2.5} className="size-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={libraryHref({ q: query.q })}
            scroll={false}
            onClick={intercept(onClear)}
            className={cn(pillLink, "px-2 font-semibold text-accent hover:underline")}
          >
            {t("clearFilters")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
