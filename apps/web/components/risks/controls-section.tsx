"use client";

import { Button, buttonVariants } from "@isms/ui";
import { RefreshCwIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { getRisk, removeControl, requestControlSuggestions } from "../../lib/actions/risks";
import { ControlPicker } from "./control-picker";
import { settle } from "./risk-call";
import { useRisk } from "./risk-context";
import { Section } from "./section";
import { ControlRefs, SuggestionList } from "./suggestion-list";
import { useControlAction } from "./use-control-action";

const POLL_MS = 3_000;
/** 3 s × 20 = 60 s, then the page stops asking. */
const MAX_POLLS = 20;

/**
 * While suggestions are pending, re-reads the risk every 3 s for up to 60 s. Returns the
 * status line: "Finding controls…", then "Suggestions ready" (or why not).
 */
function useSuggestionStatus(): {
  message: string;
  waiting: boolean;
  timedOut: boolean;
  checkAgain: () => void;
} {
  const t = useTranslations("risks.controls");
  const { risk, refreshed } = useRisk();
  const status = risk.controlSuggestion.status;
  const pending = status === "pending";
  const [message, setMessage] = useState(() => (status === "failed" ? t("failed") : ""));
  const [timedOut, setTimedOut] = useState(false);
  // Bumped to start another 60 s of refreshing while the risk is still pending.
  const [round, setRound] = useState(0);
  const latest = useRef({ refreshed, t, id: risk.id });
  latest.current = { refreshed, t, id: risk.id };
  const previous = useRef(status);

  useEffect(() => {
    if (!pending) return;
    const { t: tr, id } = latest.current;
    setTimedOut(false);
    setMessage(tr("finding"));
    let polls = 0;
    let stopped = false;
    const timer = setInterval(() => {
      polls += 1;
      const last = polls >= MAX_POLLS;
      if (last) clearInterval(timer);
      void settle(() => getRisk(id)).then((result) => {
        if (stopped) return;
        if (result.ok) latest.current.refreshed(result.data);
        const done = result.ok && result.data.controlSuggestion.status !== "pending";
        if (last && !done) {
          setTimedOut(true);
          setMessage(latest.current.t("slow"));
        }
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, round]);

  useEffect(() => {
    if (previous.current === "pending" && status === "ready") setMessage(t("ready"));
    if (previous.current === "pending" && status === "failed") setMessage(t("failed"));
    previous.current = status;
  }, [status, t]);

  return {
    message,
    waiting: pending && !timedOut,
    timedOut: pending && timedOut,
    checkAgain: () => {
      setRound((r) => r + 1);
    },
  };
}

function AcceptedList() {
  const t = useTranslations("risks.controls");
  const { risk } = useRisk();
  const { busy, run, notices } = useControlAction();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const accepted = risk.controls.filter((c) => c.status === "accepted");
  const removable = accepted.filter((c) => c.evidenceCount === 0);

  useEffect(() => {
    if (focusIndex === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>("[data-remove]") ?? [];
    const next = buttons[Math.min(focusIndex, buttons.length - 1)];
    if (next) next.focus();
    else headingRef.current?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  async function remove(controlId: string, code: string) {
    // Its place among the Remove buttons: after it goes, the next one takes that place.
    const index = removable.findIndex((c) => c.id === controlId);
    const done = await run(
      (version) => removeControl(risk.id, controlId, version),
      () => t("removed", { code }),
    );
    if (done) setFocusIndex(index);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-fg outline-none">
        {t("acceptedTitle")}
      </h3>
      {accepted.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{t("noAccepted")}</p>
      ) : (
        <ul ref={listRef} aria-label={t("acceptedLabel")} className="flex flex-col gap-2">
          {accepted.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 rounded-md border border-surface-border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1 text-[14px]">
                <p className="text-fg">
                  <span className="font-semibold tabular-nums">{c.code}</span> {c.title}
                </p>
                <p className="flex flex-wrap gap-x-3 text-[13px] text-fg-muted">
                  {c.source === "ai" ? <span>{t("aiSuggested")}</span> : null}
                  {c.decidedBy ? (
                    <span>{t("decidedBy", { name: c.decidedBy.displayName })}</span>
                  ) : null}
                </p>
                <ControlRefs control={c} />
              </div>
              {!risk.can.edit ? null : c.evidenceCount > 0 ? (
                <p className="text-[13px] text-fg-muted">{t("hasEvidence")}</p>
              ) : (
                <button
                  type="button"
                  data-remove
                  aria-disabled={busy || undefined}
                  onClick={() => void remove(c.id, c.code)}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Trash2Icon aria-hidden />
                  {t("remove")} <span className="sr-only">{c.code}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notices(() => headingRef.current?.focus())}
    </div>
  );
}

/** AI suggestions to decide on, the accepted controls, and a library search to add more. */
export function ControlsSection({ canSearchLibrary }: { canSearchLibrary: boolean }) {
  const t = useTranslations("risks.controls");
  const { risk } = useRisk();
  const { message, waiting, timedOut, checkAgain } = useSuggestionStatus();
  const suggest = useControlAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const suggestRef = useRef<HTMLButtonElement>(null);
  const edit = risk.can.edit;

  /** "Check again" goes away once refreshing restarts: focus moves to the Suggest button. */
  function restart() {
    checkAgain();
    requestAnimationFrame(() => {
      (suggestRef.current ?? headingRef.current)?.focus();
    });
  }

  async function requestSuggestions() {
    if (waiting) return;
    const done = await suggest.run((version) => requestControlSuggestions(risk.id, version));
    // Still pending from the earlier request: the status does not change, so refresh again.
    if (done?.controlSuggestion.status === "pending") checkAgain();
  }

  return (
    <Section title={t("title")} intro={t("intro")} headingRef={headingRef}>
      <div className="flex flex-col gap-2">
        {/* With AI off the library search below is the way to add controls. */}
        {edit && risk.can.suggestControls ? (
          <Button
            ref={suggestRef}
            type="button"
            variant="secondary"
            className="self-start"
            aria-disabled={waiting || suggest.busy || undefined}
            onClick={() => void requestSuggestions()}
          >
            <SparklesIcon aria-hidden />
            {t("suggest")}
          </Button>
        ) : null}
        <p data-testid="suggestion-status" role="status" className="text-[14px] text-fg">
          {message}
        </p>
        {timedOut ? (
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={restart}>
            <RefreshCwIcon aria-hidden />
            {t("checkAgain")}
          </Button>
        ) : null}
        {suggest.notices(() => headingRef.current?.focus())}
      </div>
      <SuggestionList />
      <AcceptedList />
      {edit && canSearchLibrary ? <ControlPicker /> : null}
    </Section>
  );
}
