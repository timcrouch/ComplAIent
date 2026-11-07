import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the custom tokens so `shadow-glass` and `shadow-float` override
// each other instead of stacking, and `text-label`/`text-value` count as font sizes (not
// colours) and `font-value-*` as font weights.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["glass", "float"],
      text: ["label", "value"],
      "font-weight": ["value-short", "value-long"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
