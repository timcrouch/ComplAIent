import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { controlClass } from "./control";

type SelectProps = ComponentProps<"select">;

/**
 * A native `<select>`, styled like Input. Native on purpose: long option lists (such as
 * countries) get the platform's type-to-find and accessible picker on every device.
 */
function Select({ className, children, ...props }: SelectProps) {
  return (
    <div data-slot="select" className="relative w-full">
      <select
        className={cn("h-10 cursor-pointer appearance-none pr-9", controlClass, className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  );
}

export { Select };
export type { SelectProps };
