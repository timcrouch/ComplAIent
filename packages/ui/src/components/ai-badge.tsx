import { SparklesIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

type AiState = "suggested" | "draft";

const defaultLabels: Record<AiState, string> = {
  suggested: "Suggested by AI",
  draft: "AI draft",
};

type AiBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  state: AiState;
  /** Translated text; defaults to the English label for the state. */
  label?: string;
};

/** Marks content produced by AI so people can tell it from human-authored content. */
function AiBadge({ state, label, className, ...props }: AiBadgeProps) {
  return (
    <span
      data-slot="ai-badge"
      data-state={state}
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--isms-accent)_28%,transparent)] bg-accent-soft pr-2.5 pl-2 font-sans text-xs leading-none font-semibold whitespace-nowrap text-accent",
        state === "draft" && "border-dashed",
        className,
      )}
      {...props}
    >
      <SparklesIcon aria-hidden="true" strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{label ?? defaultLabels[state]}</span>
    </span>
  );
}

export { AiBadge };
export type { AiBadgeProps, AiState };
