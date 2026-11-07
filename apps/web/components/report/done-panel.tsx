"use client";

import { Button, buttonVariants } from "@isms/ui";
import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";

/** The report is in: its reference, and the way to follow it. The heading takes focus. */
export function DonePanel({ reference, onAnother }: { reference: string; onAnother: () => void }) {
  const t = useTranslations("report.done");
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col items-start gap-4 rounded-lg border border-surface-border bg-surface p-6 shadow-glass sm:p-8"
    >
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-ok-soft text-ok">
        <CircleCheckIcon aria-hidden className="size-5" />
      </span>
      <h2
        ref={heading}
        id={`${id}-title`}
        tabIndex={-1}
        className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg outline-none"
      >
        {t("title")}
      </h2>
      <p className="flex items-baseline gap-2 text-[15px] text-fg">
        <span className="text-fg-muted">{t("referenceLabel")}</span>
        <span data-testid="report-reference" className="font-bold tabular-nums">
          {reference}
        </span>
      </p>
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-fg-muted">{t("body")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/concerns" className={buttonVariants({ variant: "primary" })}>
          {t("concernsLink")}
          <ArrowRightIcon aria-hidden />
        </Link>
        <Button type="button" variant="secondary" onClick={onAnother}>
          {t("another")}
        </Button>
      </div>
    </section>
  );
}
