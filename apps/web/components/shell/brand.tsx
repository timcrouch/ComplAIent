import { cn } from "@isms/ui";

/**
 * Product mark drawn from design tokens: a shield with a check (compliance) and a spark (AI)
 * on an accent tile. Source artwork: docs/brand/logos/01-assured-spark.svg.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[10px]",
        "bg-[linear-gradient(140deg,color-mix(in_oklab,var(--isms-accent)_72%,#ffffff),var(--isms-accent))]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_4px_12px_-4px_color-mix(in_oklab,var(--isms-accent)_60%,transparent)]",
        className,
      )}
    >
      <svg viewBox="0 0 64 64" className="size-[22px]" fill="none">
        <path
          d="M32 12 17 18v12c0 9.5 6.3 17.6 15 21.5 8.7-3.9 15-12 15-21.5V18L32 12Z"
          className="fill-on-accent/20 stroke-on-accent"
          strokeWidth={3.6}
          strokeLinejoin="round"
        />
        <path
          d="m24.5 31.5 5.5 5.5 10-11"
          className="stroke-on-accent"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M50 7c.6 4 2 5.4 6 6-4 .6-5.4 2-6 6-.6-4-2-5.4-6-6 4-.6 5.4-2 6-6Z"
          className="fill-on-accent"
        />
      </svg>
    </span>
  );
}

/**
 * The product name with "AI" picked out in the accent colour. `name` is the translated
 * app.name; the highlight applies only where it contains "AI" exactly once.
 */
export function BrandWordmark({ name, className }: { name: string; className?: string }) {
  const parts = name.split("AI");
  return (
    <span className={cn("text-[15px] font-bold tracking-[-0.01em]", className)}>
      {parts.length === 2 ? (
        <>
          {parts[0]}
          <span className="text-accent">AI</span>
          {parts[1]}
        </>
      ) : (
        name
      )}
    </span>
  );
}
