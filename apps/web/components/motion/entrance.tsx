"use client";

import { tokens } from "@isms/ui";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";

const ease = [0.2, 0.8, 0.2, 1] as const; // tokens.easing
const RISE_PX = 10;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Read once on mount. Motion's own useReducedMotion is not used: it logs a dev warning for
 * every user with reduced motion on. Motion's MotionConfig default (reducedMotion "never")
 * leaves the decision to us. The value only picks the transition, which never reaches the
 * DOM, so a server render (false) and a client render (true) still hydrate identically.
 */
function useReducedMotionPreference(): boolean {
  const [reduce] = useState(prefersReducedMotion);
  return reduce;
}

/**
 * Fade-and-rise entrance with the design-token duration (motion.slow), staggered by `order`.
 * Under reduced motion there is no animation: the duration is 0, and globals.css pins
 * `[data-entrance]` to its final state so even the server-rendered frame never moves.
 */
export function Entrance({
  children,
  order = 0,
  className,
}: {
  children: ReactNode;
  order?: number;
  className?: string;
}) {
  const reduce = useReducedMotionPreference();
  return (
    <motion.div
      data-entrance=""
      className={className}
      initial={{ opacity: 0, y: RISE_PX }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : {
              duration: tokens.motion.slow / 1000,
              delay: (order * tokens.motion.fast) / 2000,
              ease,
            }
      }
    >
      {children}
    </motion.div>
  );
}

/** Page transition: a short fade on every navigation within the app (none when reduced). */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotionPreference();
  return (
    <motion.div
      data-entrance=""
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduce ? { duration: 0 } : { duration: tokens.motion.base / 1000, ease }}
    >
      {children}
    </motion.div>
  );
}
