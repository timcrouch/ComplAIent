"use client";

import { Button, buttonVariants, cn } from "@isms/ui";
import { ArrowLeftIcon, ArrowRightIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import type { FormErrorKey, SaveStatus } from "./save-flow";

type FormFooterProps = { status: SaveStatus; formError: FormErrorKey | null; backHref?: string };

/**
 * Continue (and Back) for a setup step, with a polite live region for "Saving…" / "Saved" and
 * an alert for problems that are not about one field.
 */
export function FormFooter({ status, formError, backHref }: FormFooterProps) {
  const t = useTranslations("setup");
  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-6">
      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
        >
          <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
          <span>{t(`errors.${formError}`)}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {backHref ? (
          <Link
            href={backHref}
            onClick={requestStepHeadingFocus}
            className={cn(buttonVariants({ variant: "ghost" }), "self-start sm:mr-auto")}
          >
            <ArrowLeftIcon aria-hidden />
            {t("back")}
          </Link>
        ) : null}
        <p
          role="status"
          className="flex min-h-5 items-center gap-1.5 text-sm font-medium text-fg-muted sm:ml-auto"
        >
          {status === "saved" ? <CircleCheckIcon aria-hidden className="size-4 text-ok" /> : null}
          {status === "saving" ? t("saving") : status === "saved" ? t("saved") : ""}
        </p>
        <Button
          type="submit"
          disabled={status !== "idle"}
          focusableWhenDisabled
          className="w-full sm:w-auto"
        >
          {status === "saving" ? t("saving") : t("continue")}
          {status === "saving" ? null : <ArrowRightIcon aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

/** Back and Continue for a step that saves as it goes (people), so Continue is a link. */
export function StepLinks({ backHref, nextHref }: { backHref: string; nextHref: string }) {
  const t = useTranslations("setup");
  return (
    <div className="mt-8 flex flex-col gap-3 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-6 sm:flex-row sm:items-center">
      <Link
        href={backHref}
        onClick={requestStepHeadingFocus}
        className={cn(buttonVariants({ variant: "ghost" }), "self-start sm:mr-auto")}
      >
        <ArrowLeftIcon aria-hidden />
        {t("back")}
      </Link>
      <Link
        href={nextHref}
        onClick={requestStepHeadingFocus}
        className={cn(buttonVariants(), "w-full sm:w-auto")}
      >
        {t("continueOnly")}
        <ArrowRightIcon aria-hidden />
      </Link>
    </div>
  );
}
