import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type FieldProps = {
  /** The control's id; the hint and error get `${id}-hint` and `${id}-error`. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A labelled form field: label, optional hint and optional error (icon plus text, never
 * colour alone). Wire the control with `fieldA11y(id, { hint, error })`.
 */
function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5 font-sans", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-fg-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="flex items-start gap-1.5 text-[13px] leading-snug font-medium text-critical"
        >
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

type FieldA11y = { "aria-describedby"?: string; "aria-invalid"?: true };

/** The ARIA props that link a control to its field's hint and error. */
function fieldA11y(id: string, { hint, error }: { hint: unknown; error: unknown }): FieldA11y {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return {
    ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
  };
}

export { Field, fieldA11y };
export type { FieldProps };
