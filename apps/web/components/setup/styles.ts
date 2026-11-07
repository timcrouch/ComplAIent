/** The Clear Glass surface the setup frame, its loading skeleton and cards share. */
export const glass = "rounded-lg border border-surface-border bg-surface shadow-glass";

/**
 * A selectable card wrapping a native checkbox or radio (the whole card is its label). The
 * chosen state shows as a check in the control and an accent border, never colour alone.
 */
export const choiceCard = [
  "flex cursor-pointer items-start gap-3 rounded-md border p-4",
  "border-[color-mix(in_oklab,var(--isms-text)_10%,transparent)] bg-[color-mix(in_oklab,var(--isms-surface),transparent_35%)]",
  "transition-[background-color,border-color,box-shadow] duration-(--motion-fast) ease-standard",
  "hover:border-[color-mix(in_oklab,var(--isms-accent)_45%,transparent)]",
  "has-checked:border-accent has-checked:bg-accent-soft/60 has-checked:shadow-[0_0_0_1px_var(--isms-accent)]",
  "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-bg",
].join(" ");

/** The native control inside a choice card: platform semantics, Clear Glass colour. */
export const choiceInput =
  "mt-0.5 size-[18px] shrink-0 cursor-pointer accent-(--isms-accent) outline-none";
