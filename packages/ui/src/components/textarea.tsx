import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { controlClass } from "./control";

type TextareaProps = ComponentProps<"textarea">;

/** A multi-line text field, styled like Input. */
function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn("min-h-24 resize-y py-2.5 leading-relaxed", controlClass, className)}
      {...props}
    />
  );
}

export { Textarea };
export type { TextareaProps };
