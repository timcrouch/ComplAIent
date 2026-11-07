import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { focusRing, transition } from "./focus";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-sans font-semibold whitespace-nowrap select-none",
    "disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
    transition,
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(20_26_46/0.16),0_4px_12px_-2px_color-mix(in_oklab,var(--isms-accent)_45%,transparent)] hover:brightness-110",
        secondary:
          "border border-[color-mix(in_oklab,var(--isms-text)_10%,transparent)] bg-surface text-fg shadow-glass hover:bg-[color-mix(in_oklab,var(--isms-surface),var(--isms-text)_5%)]",
        ghost: "text-fg hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_7%)]",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
