/** Shared keyboard focus treatment: a 2px ring, offset from the element, ≥ 3:1. */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** Standard transition timing, driven by the --motion-* tokens (0ms under reduced motion). */
export const transition =
  "transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-(--motion-fast) ease-standard";
