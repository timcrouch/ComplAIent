"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { focusRingClass } from "../shell/styles";
import { sectionTitle } from "./styles";

type HomeSectionProps = {
  id: string;
  title: string;
  /** The page that lists everything this section shows the first few of. */
  more: { href: string; label: string };
  children: ReactNode;
};

/** A titled home section with a link to its full list. */
export function HomeSection({ id, title, more, children }: HomeSectionProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className={sectionTitle}>
          {title}
        </h2>
        <Link
          href={more.href}
          className={`inline-flex min-h-6 items-center gap-1 rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline ${focusRingClass}`}
        >
          {more.label}
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}
