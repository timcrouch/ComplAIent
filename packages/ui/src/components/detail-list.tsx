"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

type Density = "default" | "compact";

const DensityContext = createContext<Density>("default");

type DetailListProps = ComponentProps<"dl"> & {
  /**
   * `default`: one row per item with dividers, two columns (label ⅓, value ⅔) from `sm` up and
   * stacked on phones. `compact`: short pairs side by side with no dividers, for a list nested
   * inside a value (likelihood and impact, for example).
   */
  density?: Density;
};

/** A record's details as a description list: quiet labels, prominent user-entered values. */
function DetailList({ density = "default", className, ...props }: DetailListProps) {
  return (
    <DensityContext.Provider value={density}>
      <dl
        data-slot="detail-list"
        data-density={density}
        className={cn(
          "flex flex-col font-sans",
          density === "default" ? "divide-y divide-surface-border" : "gap-1",
          className,
        )}
        {...props}
      />
    </DensityContext.Provider>
  );
}

type DetailItemProps = {
  /** The system's name for the field, in sentence case. */
  label: ReactNode;
  /** The stored value. Null, undefined, false or blank text shows `empty` instead. */
  children?: ReactNode;
  /** `short` (names, sites, owners, dates, choices) is medium weight; `long` free text is regular. */
  emphasis?: "short" | "long" | undefined;
  /** System text for a missing value ("Not given yet", "No owner"); shown muted and italic. */
  empty?: ReactNode | undefined;
  /** A control beside the value, such as an Edit button. */
  action?: ReactNode;
  /**
   * Replaces the value with an editor that opens in place across the row. The editor carries its
   * own visible label, which is then the field's only accessible name (the term is hidden).
   */
  editor?: ReactNode;
  className?: string;
};

function isBlank(value: ReactNode): boolean {
  return (
    value === null ||
    value === undefined ||
    value === false ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** One label and value pair; use inside `DetailList`. */
function DetailItem({
  label,
  children,
  emphasis = "short",
  empty,
  action,
  editor,
  className,
}: DetailItemProps) {
  const density = useContext(DensityContext);
  const compact = density === "compact";

  if (editor !== undefined) {
    return (
      <div data-slot="detail-item" className={cn(compact ? "py-0.5" : "py-3", className)}>
        {/* Kept for valid dl markup; hidden so the editor's own label is the only name read. */}
        <dt aria-hidden="true" className="sr-only">
          {label}
        </dt>
        <dd className="min-w-0">{editor}</dd>
      </div>
    );
  }

  const blank = isBlank(children);
  const shown =
    blank && empty !== undefined ? (
      <div data-empty="true" className="min-w-0 flex-1 text-value font-normal text-fg-muted italic">
        {empty}
      </div>
    ) : (
      <div
        className={cn(
          "min-w-0 flex-1 text-value break-words whitespace-pre-line text-fg",
          emphasis === "long" ? "font-value-long" : "font-value-short",
        )}
      >
        {children}
      </div>
    );

  return (
    <div
      data-slot="detail-item"
      className={cn(
        compact
          ? "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4"
          : "flex flex-col gap-1 py-3 sm:grid sm:grid-cols-3 sm:gap-4",
        className,
      )}
    >
      <dt className={cn("text-label text-fg-muted", !compact && "sm:pt-[3px]")}>{label}</dt>
      <dd
        className={cn(
          "flex min-w-0 items-start justify-between gap-3",
          !compact && "sm:col-span-2",
        )}
      >
        {shown}
        {action}
      </dd>
    </div>
  );
}

export { DetailItem, DetailList };
export type { DetailItemProps, DetailListProps };
