import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { CheckIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing, transition } from "./focus";

type ChipProps = Omit<TogglePrimitive.Props, "pressed" | "defaultPressed" | "onPressedChange"> & {
  selected?: boolean;
  defaultSelected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
};

/**
 * A toggleable filter chip. Selection is announced through aria-pressed and is
 * shown with a check mark as well as colour, so it never relies on colour alone.
 */
function Chip({
  className,
  children,
  selected,
  defaultSelected,
  onSelectedChange,
  ...props
}: ChipProps) {
  return (
    <TogglePrimitive
      data-slot="chip"
      {...(selected === undefined ? {} : { pressed: selected })}
      {...(defaultSelected === undefined ? {} : { defaultPressed: defaultSelected })}
      {...(onSelectedChange
        ? {
            onPressedChange: (pressed: boolean) => {
              onSelectedChange(pressed);
            },
          }
        : {})}
      className={cn(
        "group inline-flex h-8 items-center gap-1.5 rounded-full border border-control-border bg-surface px-3 font-sans text-[13px] font-medium text-fg",
        "hover:bg-[color-mix(in_oklab,var(--isms-surface),var(--isms-text)_5%)]",
        "data-pressed:border-accent data-pressed:bg-accent-soft data-pressed:text-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        focusRing,
        transition,
        className,
      )}
      {...props}
    >
      <CheckIcon
        aria-hidden="true"
        strokeWidth={2.5}
        className="hidden size-3.5 group-data-pressed:block"
      />
      {children}
    </TogglePrimitive>
  );
}

export { Chip };
export type { ChipProps };
