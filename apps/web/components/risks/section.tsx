"use client";

import { cn } from "@isms/ui";
import { glass } from "../setup/styles";
import { useId, type ReactNode, type Ref } from "react";

type SectionProps = {
  title: string;
  intro?: string | undefined;
  /** For moving focus to the section when what had focus in it went away. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
};

/** One part of the risk page: a labelled region with its heading. */
export function Section({ title, intro, headingRef, children }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(glass, "flex flex-col gap-3 p-5 sm:p-6")}>
      <div className="flex flex-col gap-1">
        <h2
          id={id}
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-bold tracking-[-0.015em] text-fg outline-none"
        >
          {title}
        </h2>
        {intro ? <p className="text-[14px] leading-relaxed text-fg-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}
