"use client";

import { conflictReasons, type ApprovalReadinessDto } from "@isms/contracts";
import { Button, Field, fieldA11y, Textarea } from "@isms/ui";
import {
  CircleCheckIcon,
  CircleAlertIcon,
  InfoIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { approveRisk, returnRisk, submitRisk } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import type messages from "../../messages/index";
import { ProblemText, StaleNotice } from "./notices";
import type { Failure } from "./risk-call";
import { useRisk } from "./risk-context";
import { Section } from "./section";

type T = (typeof messages)["approval"];
type Blocker = keyof T["blockers"];
type Refusal = keyof T["refusal"];
type ErrorKey = keyof T["errors"];
/** What went wrong with the last step: blockers to list, a refusal, or another reason. */
type Problem =
  | { kind: "blockers"; blockers: Blocker[] }
  | { kind: "refusal"; refusal: Refusal }
  | { kind: "error"; error: ErrorKey };

const BLOCKERS: readonly Blocker[] = [
  "missingLikelihood",
  "missingImpact",
  "missingTreatment",
  "missingOwner",
  "unresolvedToConfirm",
];
const REFUSALS: readonly Refusal[] = ["reporter", "reviewerNeedsIndependent", "notApprover"];
const isIn = <K extends string>(list: readonly K[], value: string | null): value is K =>
  value !== null && (list as readonly string[]).includes(value);

/** The plain reason for a refused submit, approve or return; the API's own text is never shown. */
function problemOf(failure: Failure | null): Problem {
  if (!failure) return { kind: "error", error: "unavailable" };
  switch (failure.kind) {
    case "conflict": {
      const reasons = conflictReasons(failure.details);
      const blockers = reasons
        .filter((r) => r.reason === "submitBlocked")
        .map((r) => r.item)
        .filter((item) => isIn(BLOCKERS, item));
      if (blockers.length > 0) return { kind: "blockers", blockers };
      const refusal = reasons.find((r) => r.reason === "approvalRefused")?.item ?? null;
      if (isIn(REFUSALS, refusal)) return { kind: "refusal", refusal };
      const first = reasons[0]?.reason;
      if (first === "invalidTransition") return { kind: "error", error: first };
      return { kind: "error", error: "notAccepted" };
    }
    case "invalid":
      return { kind: "error", error: "invalid" };
    case "forbidden":
      return { kind: "error", error: "forbidden" };
    case "not-found":
      return { kind: "error", error: "notFound" };
    default:
      return { kind: "error", error: "unavailable" };
  }
}

function Note({ icon: Icon, children }: { icon: typeof InfoIcon; children: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[14px] leading-snug text-fg">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span>{children}</span>
    </p>
  );
}

function Decisions({ approval }: { approval: ApprovalReadinessDto }) {
  const t = useTranslations("approval");
  const { timeZone } = useRisk();
  if (approval.decisions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold text-fg">{t("decisionsTitle")}</h3>
      <ol aria-label={t("decisionsLabel")} className="flex flex-col gap-3">
        {approval.decisions.map((d) => (
          <li key={`${String(d.version)}-${d.at}`} className="flex items-start gap-3 text-[14px]">
            {d.decision === "approved" ? (
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
            ) : (
              <RotateCcwIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-semibold text-fg">
                {t(`decision.${d.decision}`, { name: d.approver.displayName })}
              </p>
              <p className="text-fg-muted">
                {t("decisionMeta", { version: d.version, date: formatDate(d.at, timeZone) })}
              </p>
              {d.comment ? <p className="whitespace-pre-line text-fg">{d.comment}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Submitting for approval, then approving or returning under separation of duties (P3-R4).
 * The API decides; this section says why something is blocked or refused, in plain words.
 * Every step goes through the risk's `change`, so open editors keep their version.
 */
export function ApprovalSection() {
  const t = useTranslations("approval");
  const { risk, change, reload } = useRisk();
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState("");
  const [commentMissing, setCommentMissing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const { approval, can, state } = risk;

  async function step(
    call: (version: number) => ReturnType<typeof submitRisk>,
    done: string,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setStale(false);
    const outcome = await change(call, () => done);
    setBusy(false);
    if (outcome.ok) {
      setComment("");
      // The button that was pressed goes with the state: keep focus in the section.
      headingRef.current?.focus();
      return;
    }
    if (outcome.stale) setStale(true);
    else if (outcome.failure) setProblem(problemOf(outcome.failure));
  }

  function returnIt() {
    if (comment.trim() === "") {
      setCommentMissing(true);
      commentRef.current?.focus();
      return;
    }
    void step((v) => returnRisk(risk.id, v, comment), t("returned"));
  }

  const commentId = `${id}-comment`;
  const commentError = commentMissing ? t("commentRequired") : undefined;
  const deciding = state === "in_review" && (can.approve || can.return);
  const refusal = state === "in_review" && !can.approve ? approval?.viewerRefusal : null;

  return (
    <Section title={t("title")} intro={t("intro")} headingRef={headingRef}>
      {approval?.noEligibleApprover && state !== "approved" ? (
        <p className="flex items-start gap-1.5 rounded-md bg-attention-soft p-3 text-[14px] font-medium text-fg">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
          <span>{t("noEligibleApprover")}</span>
        </p>
      ) : null}
      {state === "in_review" && approval ? (
        <div className="flex flex-col gap-1.5">
          <Note icon={ShieldCheckIcon}>{t("waiting")}</Note>
          <Note icon={InfoIcon}>{t("reviewer", { name: approval.reviewer.displayName })}</Note>
          <Note icon={InfoIcon}>{t(`rule.${approval.rule}`)}</Note>
        </div>
      ) : null}
      {refusal ? <Note icon={CircleAlertIcon}>{t(`refusal.${refusal}`)}</Note> : null}
      {can.submit ? (
        <Button
          type="button"
          className="self-start"
          aria-disabled={busy || undefined}
          onClick={() => void step((v) => submitRisk(risk.id, v), t("submitted"))}
        >
          <SendIcon aria-hidden />
          {busy ? t("submitting") : t("submit")}
        </Button>
      ) : null}
      {deciding ? (
        <div className="flex flex-col gap-3">
          <Field id={commentId} label={t("comment")} hint={t("commentHint")} error={commentError}>
            <Textarea
              id={commentId}
              ref={commentRef}
              value={comment}
              maxLength={2000}
              onChange={(e) => {
                setComment(e.target.value);
                setCommentMissing(false);
              }}
              {...fieldA11y(commentId, { hint: true, error: commentError })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {can.approve ? (
              <Button
                type="button"
                aria-disabled={busy || undefined}
                onClick={() => void step((v) => approveRisk(risk.id, v, comment), t("approved"))}
              >
                <CircleCheckIcon aria-hidden />
                {t("approve")}
              </Button>
            ) : null}
            {can.return ? (
              <Button
                type="button"
                variant="secondary"
                aria-disabled={busy || undefined}
                onClick={returnIt}
              >
                <RotateCcwIcon aria-hidden />
                {t("return")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* Present before it is filled, so a refusal is announced. */}
      <div role="status" className="flex flex-col gap-2">
        {problem?.kind === "blockers" ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-surface-border p-3">
            <p id={`${id}-blockers`} className="text-[14px] font-semibold text-fg">
              {t("blockersTitle")}
            </p>
            <ul
              aria-labelledby={`${id}-blockers`}
              className="flex list-disc flex-col gap-1 pl-5 text-[14px]"
            >
              {problem.blockers.map((b) => (
                <li key={b}>{t(`blockers.${b}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {problem?.kind === "refusal" ? (
          <ProblemText>{t(`refusal.${problem.refusal}`)}</ProblemText>
        ) : null}
        {problem?.kind === "error" ? (
          <ProblemText>{t(`errors.${problem.error}`)}</ProblemText>
        ) : null}
      </div>
      {stale ? (
        <StaleNotice
          onReload={async () => {
            const reloaded = await reload();
            if (reloaded) {
              setStale(false);
              headingRef.current?.focus();
            }
            return reloaded;
          }}
        />
      ) : null}
      {approval ? <Decisions approval={approval} /> : null}
    </Section>
  );
}
