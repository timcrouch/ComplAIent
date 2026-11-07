"use client";

import { cn } from "@isms/ui";
import { useTranslations } from "next-intl";
import { useId } from "react";

type SwitchRowProps = {
  label: string;
  hint: string;
  checked: boolean;
  busy: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * A native checkbox with the switch role: the platform gives keyboard and screen-reader
 * behaviour, and "On" / "Off" next to it says the state in words, not only by position.
 */
export function SwitchRow({ label, hint, checked, busy, onChange }: SwitchRowProps) {
  const t = useTranslations("settings.ai");
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-fg">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-fg-muted">
          {hint}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span aria-hidden className="w-7 text-right text-[13px] font-semibold text-fg-muted">
          {checked ? t("switchOn") : t("switchOff")}
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          aria-describedby={`${id}-hint`}
          aria-disabled={busy || undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.checked);
          }}
          className={cn(
            "relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full outline-none",
            "border border-control-border bg-[color-mix(in_oklab,var(--isms-text)_14%,transparent)]",
            "transition-colors duration-(--motion-fast) ease-standard checked:border-accent checked:bg-accent",
            "before:absolute before:top-[1px] before:left-[1px] before:size-5 before:rounded-full before:bg-white before:shadow-sm",
            "before:transition-transform before:duration-(--motion-fast) checked:before:translate-x-5",
            "focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "aria-disabled:cursor-progress aria-disabled:opacity-70 motion-reduce:transition-none motion-reduce:before:transition-none",
          )}
        />
      </div>
    </div>
  );
}
