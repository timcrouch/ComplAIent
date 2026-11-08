"use client";

import { ApproveNarrativeInput, conflictReasons, type BoardNarrativeDto } from "@isms/contracts";
import { AiBadge, Button, Textarea } from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { approveNarrative, draftNarrative } from "../../lib/actions/reports";
import { formatDate } from "../../lib/dates";
import { settle, signInAgain, type Failure } from "../risks/risk-call";

type ErrorKey =
  "empty" | "tooLong" | "figures" | "unverifiable" | "aiUnavailable" | "forbidden" | "unavailable";

type Props = {
  period: string;
  narrative: BoardNarrativeDto | null;
  /** The period is a month that ended yesterday: say so instead of "none approved yet". */
  endedYesterday: boolean;
  /** The period in words, for that message. */
  periodLabel: string;
  canDraft: boolean;
  canApprove: boolean;
  /** Scoped readers: the summary covers the whole organisation, so it is not shown to them. */
  scoped: boolean;
  timeZone: string;
};

const hasReason = (result: Failure, reason: string) =>
  result.kind === "conflict" && conflictReasons(result.details).some((r) => r.reason === reason);

function draftError(result: Failure): ErrorKey {
  if (hasReason(result, "narrativeUnverifiable")) return "unverifiable";
  if (hasReason(result, "aiUnavailable")) return "aiUnavailable";
  return result.kind === "forbidden" ? "forbidden" : "unavailable";
}

function approveError(result: Failure): ErrorKey {
  if (result.kind === "invalid") {
    return result.details.some((d) => d.path === "text") ? "figures" : "unavailable";
  }
  return result.kind === "forbidden" ? "forbidden" : "unavailable";
}

/**
 * The period's narrative: the approved text, and for people who may, a way to draft one with
 * the AI (shown as an editable draft, never saved on its own) or write one by hand. Saving
 * is always a person's decision ("Use in board pack"); the API refuses figures not in the records.
 */
export function BoardNarrative({
  period,
  narrative,
  endedYesterday,
  periodLabel,
  canDraft,
  canApprove,
  scoped,
  timeZone,
}: Props) {
  const t = useTranslations("reports.board.narrative");
  const id = useId();
  const [approved, setApproved] = useState(narrative);
  const [text, setText] = useState<string | null>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drafting" | "saving" | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusTarget, setFocusTarget] = useState<"editor" | "approved" | "opener" | null>(null);
  const opener = useRef<"draft" | "write">("draft");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const approvedRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLButtonElement>(null);
  const writeRef = useRef<HTMLButtonElement>(null);
  const editing = text !== null;

  // Focus moves after the render that shows its target.
  useEffect(() => {
    if (!focusTarget) return;
    const target =
      focusTarget === "editor"
        ? editorRef.current
        : focusTarget === "approved"
          ? approvedRef.current
          : opener.current === "draft" && draftRef.current
            ? draftRef.current
            : writeRef.current;
    target?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const fail = (key: ErrorKey) => {
    // The error paragraph is role="alert", so it is announced by itself.
    setError(key);
    setAnnouncement("");
  };

  async function draft() {
    if (busy) return;
    opener.current = "draft";
    setBusy("drafting");
    setError(null);
    setAnnouncement(t("announce.drafting"));
    const result = await settle(() => draftNarrative(period));
    setBusy(null);
    if (result.ok) {
      setText(result.data.text);
      setInteractionId(result.data.interactionId);
      setAnnouncement(t("announce.ready"));
      setFocusTarget("editor");
    } else if (!signInAgain(result)) fail(draftError(result));
  }

  async function save() {
    if (busy || text === null) return;
    const input = { period, text: text.trim(), interactionId };
    const parsed = ApproveNarrativeInput.safeParse(input);
    if (!parsed.success) {
      fail(input.text === "" ? "empty" : "tooLong");
      setFocusTarget("editor");
      return;
    }
    setBusy("saving");
    setError(null);
    setAnnouncement("");
    const result = await settle(() => approveNarrative(parsed.data));
    setBusy(null);
    if (result.ok) {
      setApproved(result.data);
      setText(null);
      setInteractionId(null);
      setAnnouncement(t("announce.saved"));
      setFocusTarget("approved");
    } else if (!signInAgain(result)) fail(approveError(result));
  }

  function body() {
    if (scoped) return <p className="text-sm text-fg-muted">{t("scoped")}</p>;
    if (!approved) {
      return (
        <p className="text-sm text-fg-muted">
          {endedYesterday ? t("justEnded", { period: periodLabel }) : t("none")}
        </p>
      );
    }
    return (
      <div ref={approvedRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <p className="max-w-[68ch] text-[15px] leading-relaxed whitespace-pre-line text-fg">
          {approved.text}
        </p>
        <p className="text-[13px] text-fg-muted">
          {t("approvedBy", {
            name: approved.approvedBy,
            date: formatDate(approved.approvedAt, timeZone),
          })}
        </p>
        {approved.aiAssisted ? (
          <p className="text-[13px] text-fg-muted">{t("aiAssisted")}</p>
        ) : null}
      </div>
    );
  }

  const errorNote = error ? (
    <p
      id={`${id}-error`}
      role="alert"
      className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{t(`errors.${error}`)}</span>
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {body()}
      {!scoped && (canDraft || canApprove) ? (
        editing ? (
          <div className="flex flex-col gap-3">
            {interactionId ? (
              <div className="flex flex-wrap items-center gap-2">
                <AiBadge state="draft" label={t("aiBadge")} />
                <span className="text-[13px] font-medium text-fg-muted">
                  {t("checkEverySentence")}
                </span>
              </div>
            ) : null}
            <label htmlFor={`${id}-text`} className="text-sm font-semibold text-fg">
              {t("label")}
            </label>
            <p id={`${id}-hint`} className="text-[13px] text-fg-muted">
              {t("replaceHint")}
            </p>
            <Textarea
              id={`${id}-text`}
              ref={editorRef}
              aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
              rows={9}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              aria-invalid={
                error === "empty" || error === "tooLong" || error === "figures" || undefined
              }
            />
            {errorNote}
            <div className="flex flex-wrap items-center gap-3">
              {canApprove ? (
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy !== null}
                  focusableWhenDisabled
                >
                  {busy === "saving" ? t("saving") : t("use")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setText(null);
                  setInteractionId(null);
                  setError(null);
                  setFocusTarget("opener");
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {canDraft ? (
              <Button
                ref={draftRef}
                type="button"
                onClick={() => void draft()}
                disabled={busy !== null}
                focusableWhenDisabled
              >
                {busy === "drafting" ? t("drafting") : t("draft")}
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                ref={writeRef}
                type="button"
                variant="secondary"
                onClick={() => {
                  opener.current = "write";
                  setText(approved?.text ?? "");
                  setInteractionId(null);
                  setError(null);
                  setFocusTarget("editor");
                }}
              >
                {approved ? t("edit") : t("write")}
              </Button>
            ) : null}
          </div>
        )
      ) : null}
      {error && !editing ? errorNote : null}
    </div>
  );
}
