import { transition } from "./focus";

/** The Clear Glass text-control look shared by Input, Textarea and Select. */
export const controlClass = [
  "w-full min-w-0 rounded-sm border border-control-border bg-surface px-3 font-sans text-sm text-fg shadow-glass",
  "placeholder:text-fg-muted",
  "outline-none focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/35",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-critical aria-invalid:ring-2 aria-invalid:ring-critical/25",
  transition,
].join(" ");
