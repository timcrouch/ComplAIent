"use client";

import { cn } from "@isms/ui";
import { useId, type ReactNode } from "react";

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: ReactNode };

type SegmentedProps<T extends string> = {
  legend: string;
  name: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Extra content beside the legend (e.g. an info tooltip). */
  aside?: ReactNode;
  describedBy?: string;
};

/**
 * A radio group drawn as a segmented control. Native radios keep arrow-key navigation and
 * form semantics; the focus ring is drawn on the segment that holds the focused radio.
 */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  aside,
  describedBy,
}: SegmentedProps<T>) {
  const legendId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span id={legendId} className="text-xs font-semibold text-fg-muted">
          {legend}
        </span>
        {aside}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={legendId}
        aria-describedby={describedBy}
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-sm bg-[color-mix(in_oklab,var(--isms-text)_6%,transparent)] p-1"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-2 text-[13px] font-semibold text-fg-muted select-none",
              "transition-[background-color,color,box-shadow] duration-(--motion-fast) ease-standard",
              "hover:text-fg has-checked:bg-bg has-checked:text-fg has-checked:shadow-glass",
              "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring has-focus-visible:ring-offset-1 has-focus-visible:ring-offset-bg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            {option.icon}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
