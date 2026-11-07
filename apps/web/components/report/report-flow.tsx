"use client";

import type { ConversationDto } from "@isms/contracts";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { getConcern, replyToConcern, startConcern } from "../../lib/actions/report";
import { focusRingClass } from "../shell/styles";
import { ChatComposer } from "./chat-composer";
import { ChatThread, type ThreadMessage } from "./chat-thread";
import { DonePanel } from "./done-panel";
import {
  aiFailed,
  failureMessage,
  keptConversationId,
  settle,
  signInAgain,
  staleTurn,
  useReportSubmit,
} from "./report-call";
import {
  emptyValues,
  valuesFromMessages,
  type ReportErrorKey,
  type ReportValues,
  type SiteOption,
} from "./report-fields";
import { ReportForm } from "./report-form";
import { FormError } from "./report-inputs";
import { SummaryCard } from "./summary-card";

type Mode =
  | { kind: "chat" }
  | { kind: "form"; initial: ReportValues; fallback: boolean }
  | { kind: "done"; reference: string };

type ReportFlowProps = {
  /** The AI can run a turn now (`aiStatus`). */
  aiAvailable: boolean;
  /** `?mode=form`: the reporter chose the form. */
  startInForm: boolean;
  sites: readonly SiteOption[];
};

const reporterTexts = (c: ConversationDto | null): string[] =>
  c ? c.messages.filter((m) => m.role === "reporter").map((m) => m.text) : [];

const linkClass = `self-start inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline ${focusRingClass}`;

/**
 * Reporting a concern: a conversation with the assistant that ends in an editable summary, or
 * a step form when AI is unavailable, chosen, or fails mid-conversation (prefilled with the
 * reporter's own words, and still reported through the kept conversation).
 */
export function ReportFlow({ aiAvailable, startInForm, sites }: ReportFlowProps) {
  const t = useTranslations("report");
  const initialMode = (): Mode =>
    aiAvailable && !startInForm
      ? { kind: "chat" }
      : { kind: "form", initial: emptyValues(), fallback: false };
  const [mode, setMode] = useState<Mode>(initialMode);
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [keptId, setKeptId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    text: string;
    notSure: boolean;
  } | null>(null);
  const [error, setError] = useState<ReportErrorKey | null>(null);
  // Bumped when a turn ends or the flow restarts: focus then moves to what comes next.
  const [focusTurn, setFocusTurn] = useState(0);
  const [restarted, setRestarted] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const sender = useReportSubmit(conversation?.id ?? keptId, (risk) => {
    setMode({ kind: "done", reference: risk.reference });
  });

  /**
   * Keyboard focus never falls to the page: after a turn it goes to the new question's first
   * suggested answer, else the composer. The summary card focuses its own heading.
   */
  useEffect(() => {
    if (focusTurn === 0) return;
    const root = chatRef.current;
    if (!root || root.querySelector("[data-summary]")) return;
    const target =
      root.querySelector<HTMLElement>("[data-chip=ai]") ??
      root.querySelector<HTMLElement>("[data-composer]");
    target?.focus();
  }, [focusTurn]);

  function reset() {
    setConversation(null);
    setKeptId(null);
    setError(null);
    sender.setError(null);
    setRestarted(true);
    setMode(initialMode());
    setFocusTurn((n) => n + 1);
  }

  /** Sends the reporter's words; true once the API has them (the composer then clears). */
  async function send(text: string, notSure = false): Promise<boolean> {
    if (pending) return false;
    setPending({ text, notSure });
    setError(null);
    const current = conversation;
    const result = await settle(() =>
      current ? replyToConcern(current.id, text, notSure) : startConcern(text),
    );
    setPending(null);
    setFocusTurn((n) => n + 1);
    if (result.ok) {
      setConversation(result.data);
      return true;
    }
    if (signInAgain(result)) return false;
    if (aiFailed(result)) {
      // The conversation stays open with every word kept; the form finishes the report.
      setKeptId(current?.id ?? keptConversationId(result));
      setMode({
        kind: "form",
        initial: valuesFromMessages([...reporterTexts(current), text]),
        fallback: true,
      });
      return true;
    }
    if (current && staleTurn(result)) {
      // Another turn wrote first (a double send): show the conversation as stored.
      const again = await settle(() => getConcern(current.id));
      if (again.ok) {
        setConversation(again.data);
        setFocusTurn((n) => n + 1);
        return true;
      }
    }
    setError(failureMessage(result));
    return false;
  }

  if (mode.kind === "done") {
    return <DonePanel reference={mode.reference} onAnother={reset} />;
  }

  if (mode.kind === "form") {
    return (
      <div className="flex flex-col gap-4">
        <ReportForm
          sites={sites}
          initial={mode.initial}
          fallback={mode.fallback}
          focusOnMount={restarted}
          sender={sender}
        />
        {aiAvailable && !mode.fallback ? (
          <Link href="/report" className={linkClass}>
            {t("useChat")}
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
    );
  }

  const messages: ThreadMessage[] = (conversation?.messages ?? [])
    .filter((m) => m.role === "reporter" || m.text.length > 0)
    .map((m) => ({
      key: String(m.seq),
      role: m.role,
      text: m.text,
      notSure: m.notSure,
    }));
  // Keyed by the seq the API will give it, so the stored copy replaces it in place and the
  // polite log does not announce the reporter's words a second time.
  const nextSeq = (conversation?.messages.at(-1)?.seq ?? 0) + 1;
  if (pending) messages.push({ key: String(nextSeq), role: "reporter", ...pending });
  const last = conversation?.messages.at(-1);
  const draft = conversation?.draft ?? null;
  const asking = !draft && last?.role === "assistant" && last.text.length > 0;

  return (
    <div ref={chatRef} className="flex flex-col gap-6">
      <ChatThread
        messages={messages}
        answers={asking && !pending ? last.chips : null}
        typing={pending !== null}
        announcement={draft ? t("chat.summaryReady") : ""}
        onAnswer={(text, notSure) => void send(text, notSure)}
      />
      <FormError error={error} />
      {draft && conversation ? (
        <SummaryCard key={conversation.id} draft={draft} sites={sites} sender={sender} />
      ) : (
        <ChatComposer busy={pending !== null} onSend={send} />
      )}
      {conversation === null ? (
        <Link href="/report?mode=form" className={linkClass}>
          {t("useForm")}
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
