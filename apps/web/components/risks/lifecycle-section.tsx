"use client";

import { conflictReasons } from "@isms/contracts";
import { Button } from "@isms/ui";
import { CircleAlertIcon, CircleCheckIcon, ClockAlertIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { closeRisk, confirmReview, reassessRisk } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import { NoteDialog, type NoteResult } from "./note-dialog";
import { useErrorText } from "./notices";
import { useRisk } from "./risk-context";
import { Section } from "./section";

type Kind = "close" | "confirm" | "reassess";
type DialogKey = "close_dialog" | "confirm_dialog" | "reassess_dialog";
const DIALOG: Record<Kind, DialogKey> = {
  close: "close_dialog",
  confirm: "confirm_dialog",
  reassess: "reassess_dialog",
};
const REASONS = ["openTreatmentActions", "riskClosed", "invalidTransition"] as const;
type Reason = (typeof REASONS)[number];
const isReason = (value: string | null): value is Reason =>
  value !== null && (REASONS as readonly string[]).includes(value);

function ReviewLine() {
  const t = useTranslations("insights.lifecycle");
  const { risk, timeZone } = useRisk();
  const { nextReviewDue: due, reviewDue } = risk;
  // A closed risk is reviewed too: the treated line, then its next review date.
  const treated =
    risk.state === "closed" && risk.closedAt && risk.closedBy ? (
      <p className="flex items-start gap-1.5 text-[14px] text-fg">
        <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
        <span>
          {t("treated", {
            date: formatDate(risk.closedAt, timeZone),
            name: risk.closedBy.displayName,
          })}
        </span>
      </p>
    ) : null;
  // The API decides whether the review is due (UTC calendar day); no client clock here.
  const review = due ? (
    <p className="flex items-start gap-1.5 text-[14px] font-medium text-fg">
      {reviewDue ? (
        <ClockAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
      ) : null}
      <span>{t(reviewDue ? "dueForReview" : "nextReview", { date: formatDate(due, "UTC") })}</span>
    </p>
  ) : (
    <p className="text-[14px] text-fg-muted">{t("noReviewDate")}</p>
  );
  return (
    <>
      {treated}
      {review}
    </>
  );
}

/**
 * Keeping an approved risk up to date: mark it as treated, confirm it is still accurate, or
 * reassess it. Each opens a small dialog for the note or reason; the API decides what is
 * allowed (`can`), and a refusal is explained in the dialog.
 */
export function LifecycleSection() {
  const t = useTranslations("insights.lifecycle");
  const errorText = useErrorText();
  const { risk, change, reload } = useRisk();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const { can, state, treatmentPlan } = risk;
  if (state !== "approved" && state !== "closed") return null;

  const calls = {
    close: (v: number, note: string) => closeRisk(risk.id, v, note),
    confirm: (v: number, note: string) => confirmReview(risk.id, v, note),
    reassess: (v: number, note: string) => reassessRisk(risk.id, v, note),
  };

  async function submit(kind: Kind, note: string): Promise<NoteResult> {
    const outcome = await change(
      (v) => calls[kind](v, note),
      () => t(`${DIALOG[kind]}.done`),
    );
    if (outcome.ok) {
      setOpen(null);
      return { ok: true };
    }
    if (outcome.stale) return { ok: false, stale: true };
    const reason = outcome.failure
      ? (conflictReasons(outcome.failure.details)[0]?.reason ?? null)
      : null;
    if (isReason(reason)) return { ok: false, message: t(`errors.${reason}`) };
    return { ok: false, message: errorText(outcome.error ?? "unavailable") };
  }

  // The close button is replaced by this line while actions are open (a reviewer sees it).
  const blockedByActions =
    state === "approved" && !can.close && treatmentPlan.open > 0 && can.reassess;

  return (
    <Section title={t("title")} intro={t("intro")} headingRef={headingRef}>
      <ReviewLine />
      {blockedByActions ? (
        <p className="flex items-start gap-1.5 text-[14px] font-medium text-fg">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
          <span>{t("openActions")}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {can.close ? (
          <Button
            type="button"
            onClick={() => {
              setOpen("close");
            }}
          >
            <CircleCheckIcon aria-hidden />
            {t("close")}
          </Button>
        ) : null}
        {can.confirmReview ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen("confirm");
            }}
          >
            {t("confirm")}
          </Button>
        ) : null}
        {can.reassess ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen("reassess");
            }}
          >
            <RotateCcwIcon aria-hidden />
            {t("reassess")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <NoteDialog
          key={open}
          open
          onOpenChange={(next) => {
            if (!next) setOpen(null);
          }}
          title={t(`${DIALOG[open]}.title`)}
          description={t(`${DIALOG[open]}.description`)}
          label={t(`${DIALOG[open]}.label`)}
          submitLabel={t(`${DIALOG[open]}.submit`)}
          required={open !== "confirm"}
          submit={(note) => submit(open, note)}
          onReload={async () => {
            const reloaded = await reload();
            if (reloaded) setOpen(null);
            return reloaded;
          }}
          finalFocus={() => headingRef.current ?? true}
        />
      ) : null}
    </Section>
  );
}
