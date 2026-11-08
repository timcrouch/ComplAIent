"use client";

import {
  AiObligationStatusSchema,
  conflictReasons,
  UpdateAiObligationInput,
  type AiObligationDto,
  type AiObligationGuidanceResponse,
  type AiSystemDetailDto,
} from "@isms/contracts";
import { AiBadge, Button, Select, Textarea } from "@isms/ui";
import { CircleCheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { suggestAiObligationSteps, updateAiObligation } from "../../lib/actions/ai-act";
import { formatDate } from "../../lib/dates";
import { ProblemText } from "../risks/notices";
import { settle, signInAgain } from "../risks/risk-call";

type SaveError = "note" | "forbidden" | "unavailable";
type SuggestError = "aiUnavailable" | "failed";

type Props = {
  systemId: string;
  obligation: AiObligationDto;
  canManage: boolean;
  /** The viewer may ask the AI for steps (the system's `canSuggestGuidance`). */
  canSuggest: boolean;
  timeZone: string;
  onSaved: (system: AiSystemDetailDto) => void;
};

/** The suggested steps as numbered lines, with the evidence hint, ready to append to a note. */
export function guidanceText(guidance: AiObligationGuidanceResponse, evidence: string): string {
  const steps = guidance.steps.map((step, i) => `${String(i + 1)}. ${step}`);
  return [...steps, ...(guidance.evidenceHint ? [evidence] : [])].join("\n");
}

/**
 * One applicable obligation: what it asks, in words a person can act on without AI, its
 * article, and (for people who may) a status and a note saved together. "Suggest steps (AI)"
 * shows steps labelled as an AI suggestion; "Add to note" only fills the editor.
 */
export function ObligationItem({
  systemId,
  obligation,
  canManage,
  canSuggest,
  timeZone,
  onSaved,
}: Props) {
  const t = useTranslations("aiAct.obligations");
  const tr = useTranslations("aiActRules");
  const ts = useTranslations("aiAct.obligationStatuses");
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState(obligation.status);
  const [note, setNote] = useState(obligation.note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const [guidance, setGuidance] = useState<AiObligationGuidanceResponse | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<SuggestError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const title = tr(`obligationTitles.${obligation.key}`);
  const forTitle = t("forTitle", { title });
  const changed = status !== obligation.status || note.trim() !== obligation.note;

  async function save() {
    if (saving || !changed) return;
    const parsed = UpdateAiObligationInput.safeParse({
      ...(status !== obligation.status ? { status } : {}),
      ...(note.trim() !== obligation.note ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError("note");
      noteRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await settle(() => updateAiObligation(systemId, obligation.key, parsed.data));
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      setNote(note.trim());
      onSaved(result.data);
    } else if (!signInAgain(result)) {
      setError(
        result.kind === "invalid"
          ? "note"
          : result.kind === "forbidden"
            ? "forbidden"
            : "unavailable",
      );
    }
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setAnnouncement(t("announceWorking"));
    const result = await settle(() => suggestAiObligationSteps(systemId, obligation.key));
    setSuggesting(false);
    if (result.ok) {
      setGuidance(result.data);
      setAnnouncement(t("announceDone"));
    } else if (!signInAgain(result)) {
      const ai =
        result.kind === "conflict" &&
        conflictReasons(result.details).some((r) => r.reason === "aiUnavailable");
      setAnnouncement("");
      setSuggestError(ai ? "aiUnavailable" : "failed");
    }
  }

  /** Appends the steps to the note; nothing is stored until the person saves. */
  function addToNote() {
    if (!guidance) return;
    const text = guidanceText(guidance, t("evidenceHint", { hint: guidance.evidenceHint ?? "" }));
    setNote((current) => (current.trim() === "" ? text : `${current.trimEnd()}\n${text}`));
    setGuidance(null);
    setSaved(false);
    setAnnouncement("");
    noteRef.current?.focus();
  }

  return (
    <li
      data-obligation={obligation.key}
      className="flex flex-col gap-3 rounded-md border border-surface-border p-4"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
          <span className="text-[13px] font-semibold text-fg-muted tabular-nums">
            {obligation.article}
          </span>
        </div>
        <p className="max-w-[68ch] text-sm leading-relaxed text-fg-muted">
          {tr(`obligationDescriptions.${obligation.key}`)}
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 sm:max-w-56">
            <label htmlFor={`${id}-status`} className="text-sm font-semibold text-fg">
              {t("statusLabel")} <span className="sr-only">{forTitle}</span>
            </label>
            <Select
              id={`${id}-status`}
              value={status}
              onChange={(e) => {
                setStatus(AiObligationStatusSchema.parse(e.target.value));
                setSaved(false);
              }}
            >
              {AiObligationStatusSchema.options.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-note`} className="text-sm font-semibold text-fg">
              {t("noteLabel")} <span className="sr-only">{forTitle}</span>
            </label>
            <p id={`${id}-note-hint`} className="text-[13px] text-fg-muted">
              {t("noteHint")}
            </p>
            <Textarea
              id={`${id}-note`}
              ref={noteRef}
              rows={3}
              value={note}
              aria-describedby={`${id}-note-hint`}
              aria-invalid={error === "note" || undefined}
              onChange={(e) => {
                setNote(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          {guidance ? (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_35%,transparent)] p-3.5">
              <AiBadge state="suggested" label={t("suggestBadge")} />
              <ol
                aria-label={t("stepsLabel", { title })}
                className="list-decimal pl-5 text-sm leading-relaxed text-fg"
              >
                {guidance.steps.map((step, i) => (
                  // Steps may repeat word for word and never reorder: key by position.
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {guidance.evidenceHint ? (
                <p className="text-sm text-fg">
                  {t("evidenceHint", { hint: guidance.evidenceHint })}
                </p>
              ) : null}
              <p className="text-[13px] text-fg-muted">{t("suggestNote")}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={addToNote}>
                  {t("addToNote")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setGuidance(null);
                    setAnnouncement("");
                  }}
                >
                  {t("dismiss")}
                </Button>
              </div>
            </div>
          ) : null}
          {suggestError ? <ProblemText>{t(`errors.${suggestError}`)}</ProblemText> : null}
          {error ? (
            <div role="alert">
              <ProblemText>{t(`errors.${error}`)}</ProblemText>
            </div>
          ) : null}
          <p role="status" className="sr-only">
            {announcement}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={saving || !changed}
              focusableWhenDisabled
              onClick={() => void save()}
            >
              {saving ? t("saving") : t("save")} <span className="sr-only">{forTitle}</span>
            </Button>
            {canSuggest ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={suggesting}
                focusableWhenDisabled
                onClick={() => void suggest()}
              >
                <SparklesIcon aria-hidden />
                {suggesting ? t("suggesting") : t("suggest")}{" "}
                <span className="sr-only">{forTitle}</span>
              </Button>
            ) : null}
            <span
              role="status"
              className="flex items-center gap-1.5 text-sm font-medium text-fg-muted"
            >
              {saved ? (
                <>
                  <CircleCheckIcon aria-hidden className="size-4 text-ok" />
                  {t("saved")}
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : (
        <ReadOnly obligation={obligation} />
      )}
      {obligation.updatedBy ? (
        <p className="text-[13px] text-fg-muted">
          {t("updatedBy", {
            name: obligation.updatedBy.displayName,
            date: formatDate(obligation.updatedAt, timeZone),
          })}
        </p>
      ) : null}
    </li>
  );
}

/** The status and note as recorded, for people who may not change them. */
export function ReadOnly({ obligation }: { obligation: AiObligationDto }) {
  const t = useTranslations("aiAct.obligations");
  const ts = useTranslations("aiAct.obligationStatuses");
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-fg">
        <span className="font-semibold">{t("statusLabel")}:</span> {ts(obligation.status)}
      </p>
      <p className="text-sm whitespace-pre-line text-fg">
        {obligation.note === "" ? (
          <span className="text-fg-muted italic">{t("noNote")}</span>
        ) : (
          obligation.note
        )}
      </p>
    </div>
  );
}
