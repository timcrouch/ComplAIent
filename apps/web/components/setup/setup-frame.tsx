"use client";

import type { SetupStep } from "@isms/contracts";
import { cn } from "@isms/ui";
import { CheckIcon, LightbulbIcon, PuzzleIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { consumeStepHeadingFocus, requestStepHeadingFocus } from "../../lib/step-focus";
import { Entrance } from "../motion/entrance";
import { focusRingClass } from "../shell/styles";
import { glass } from "./styles";
import {
  firstIncompleteStep,
  isStepDone,
  SETUP_SECTIONS,
  SETUP_STEPS,
  type FramePageKey,
  type FrameStepKey,
} from "./steps";

export type { FramePageKey, FrameStepKey };

const railLink = cn(
  "transition-colors duration-(--motion-fast) ease-standard hover:text-fg",
  "hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_6%)]",
  focusRingClass,
);

type SetupFrameProps = {
  /** A step, or an optional section (not numbered, never in `missing`). */
  current: FramePageKey;
  /** The API's `setup.missing`, which decides what shows as done. */
  missing: readonly SetupStep[];
  children: ReactNode;
};

/**
 * The frame every setup step shares: the ordered step list, where you are, and why the step
 * asks what it asks. A step is done only when the API no longer reports it as missing.
 * Optional sections (Modules) follow the steps, unnumbered, and are always reachable.
 */
export function SetupFrame({ current, missing, children }: SetupFrameProps) {
  const t = useTranslations("setup");
  const index = SETUP_STEPS.findIndex((s) => s.key === current);
  const reachable = firstIncompleteStep(missing).key;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // After moving between steps inside the app, start at the new step's heading (the old
  // submit button is gone, so focus would fall to the body). Only an explicit request
  // counts: on a full page load the frame may hydrate after the shell (streaming).
  useEffect(() => {
    if (consumeStepHeadingFocus()) headingRef.current?.focus();
  }, [current]);

  return (
    <div className="mx-auto grid w-full max-w-[1040px] gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
      <Entrance className="lg:sticky lg:top-6 lg:self-start">
        <nav aria-label={t("stepsLabel")} className={cn(glass, "p-2 lg:p-3")}>
          <p className="hidden px-2 pt-1 pb-3 text-xs font-bold tracking-[0.08em] text-fg-muted uppercase lg:block">
            {t("title")}
          </p>
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-1">
            {SETUP_STEPS.map((step, i) => {
              const done = isStepDone(step, missing);
              const isCurrent = step.key === current;
              const linked = !isCurrent && (done || step.key === reachable);
              const body = (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      done && "bg-ok-soft text-ok",
                      !done && isCurrent && "bg-accent text-on-accent",
                      !done && !isCurrent && "border border-control-border text-fg-muted",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0 leading-tight">{t(`steps.${step.key}`)}</span>
                  {done ? (
                    <>
                      {" "}
                      <span className="sr-only">{t("done")}</span>
                    </>
                  ) : null}
                </>
              );
              const itemClass = cn(
                "flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-semibold md:flex-col md:text-center lg:flex-row lg:px-2.5 lg:text-left lg:text-sm",
                isCurrent ? "bg-accent-soft text-accent" : "text-fg-muted",
              );
              return (
                <li key={step.key}>
                  {linked ? (
                    <Link
                      href={step.path}
                      onClick={requestStepHeadingFocus}
                      className={cn(itemClass, railLink)}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span aria-current={isCurrent ? "step" : undefined} className={itemClass}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="hidden px-2 pt-4 pb-2 text-xs font-bold tracking-[0.08em] text-fg-muted uppercase lg:block">
            {t("sectionsLabel")}
          </p>
          <ul
            aria-label={t("sectionsLabel")}
            className="mt-1 grid grid-cols-2 gap-1 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-1 sm:grid-cols-3 md:grid-cols-6 lg:mt-0 lg:grid-cols-1 lg:border-t-0 lg:pt-0"
          >
            {SETUP_SECTIONS.map((section) => {
              const isCurrent = section.key === current;
              const itemClass = cn(
                "flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-semibold md:flex-col md:text-center lg:flex-row lg:px-2.5 lg:text-left lg:text-sm",
                isCurrent ? "bg-accent-soft text-accent" : "text-fg-muted",
              );
              const body = (
                <>
                  <span
                    aria-hidden
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-control-border"
                  >
                    <PuzzleIcon className="size-3.5" strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 leading-tight">{t(`sections.${section.key}`)}</span>
                </>
              );
              return (
                <li key={section.key}>
                  {isCurrent ? (
                    <span aria-current="page" className={itemClass}>
                      {body}
                    </span>
                  ) : (
                    <Link
                      href={section.path}
                      onClick={requestStepHeadingFocus}
                      className={cn(itemClass, railLink)}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </Entrance>

      <div className="flex min-w-0 flex-col gap-6">
        <Entrance order={1} className="flex flex-col gap-3">
          <p className="text-[13px] font-semibold text-accent">
            {index >= 0
              ? t("stepOf", { current: index + 1, total: SETUP_STEPS.length })
              : t("optional")}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            id="setup-step-title"
            className="outline-none text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]"
          >
            {t(`${current}.title`)}
          </h1>
          <p className="flex max-w-[60ch] items-start gap-2.5 text-[15px] leading-relaxed text-fg-muted">
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
              <LightbulbIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
            </span>
            <span>
              <strong className="font-semibold text-fg">{t("whyLabel")}</strong>{" "}
              <span>{t(`${current}.why`)}</span>
            </span>
          </p>
        </Entrance>
        <Entrance order={2}>
          <section
            aria-labelledby="setup-step-title"
            className={cn(glass, "relative overflow-hidden p-5 sm:p-8")}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-28 -right-28 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--isms-accent)_12%,transparent),transparent)]"
            />
            <div className="relative">{children}</div>
          </section>
        </Entrance>
      </div>
    </div>
  );
}
