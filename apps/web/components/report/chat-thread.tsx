"use client";

import { AiBadge, cn } from "@isms/ui";
import { CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";
import { BeaconBotAvatar } from "./beacon-bot-avatar";

export type ThreadMessage = {
  key: string;
  role: "reporter" | "assistant";
  text: string;
  notSure: boolean;
};

type ChatThreadProps = {
  messages: readonly ThreadMessage[];
  /** The chips of the question waiting for an answer; null when nothing is asked now. */
  answers: readonly string[] | null;
  /** A turn is running: the typing indicator shows and answers wait. */
  typing: boolean;
  /** Announced once, e.g. when the summary is ready. */
  announcement: string;
  onAnswer: (text: string, notSure: boolean) => void;
};

const bubble = "max-w-[min(560px,85%)] rounded-lg px-4 py-3 text-[15px] leading-relaxed";

/**
 * The conversation: a polite log of the questions and answers. The answer chips and the
 * typing indicator sit outside the log, so only messages are announced as they arrive.
 */
export function ChatThread({ messages, answers, typing, announcement, onAnswer }: ChatThreadProps) {
  const t = useTranslations("report.chat");
  // Each chip once; "Not sure" is always offered by us, so an AI chip of that name is dropped.
  const chips = [...new Set(answers ?? [])].filter(
    (c) => c.trim().toLowerCase() !== t("notSure").toLowerCase(),
  );
  return (
    <div className="flex flex-col gap-4">
      <div role="log" aria-live="polite" aria-label={t("logLabel")} className="flex flex-col gap-3">
        <AssistantBubble testId="assistant-prompt" text={t("firstPrompt")} ai={false} />
        {messages.map((m) =>
          m.role === "assistant" ? (
            <AssistantBubble key={m.key} testId="assistant-question" text={m.text} ai />
          ) : (
            <div key={m.key} data-message className="flex flex-col items-end gap-1">
              <p className={cn(bubble, "bg-accent text-on-accent whitespace-pre-line")}>
                <span className="sr-only">{t("you")}: </span>
                <span>{m.text}</span>
              </p>
              {m.notSure ? (
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
                  <CircleHelpIcon aria-hidden className="size-3.5" />
                  {t("notSureNote")}
                </p>
              ) : null}
            </div>
          ),
        )}
      </div>

      <p role="status" className={typing ? "flex items-center gap-2.5" : "sr-only"}>
        {typing ? (
          <>
            <BeaconBotAvatar className="size-8" />
            <span
              aria-hidden
              className="flex gap-1 rounded-full bg-surface px-3 py-2.5 shadow-glass"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-pulse rounded-full bg-fg-muted motion-reduce:animate-none"
                  style={{ animationDelay: `${String(i * 150)}ms` }}
                />
              ))}
            </span>
            <span className="text-[13px] font-medium text-fg-muted">{t("typing")}</span>
          </>
        ) : (
          announcement
        )}
      </p>

      {answers && !typing ? (
        <div
          role="group"
          aria-label={t("answersLabel")}
          className="flex flex-wrap items-center gap-2 sm:pl-11"
        >
          {chips.length > 0 ? <AiBadge state="suggested" label={t("chipsBadge")} /> : null}
          {chips.map((chip, i) => (
            <AnswerChip
              key={i}
              ai
              label={chip}
              onClick={() => {
                onAnswer(chip, false);
              }}
            />
          ))}
          <AnswerChip
            label={t("notSure")}
            quiet
            onClick={() => {
              onAnswer(t("notSure"), true);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One assistant message. The AI's questions carry an AiBadge; the first prompt is ours (from the
 * message file), so it has only the speaker name for screen readers.
 */
function AssistantBubble({ text, testId, ai }: { text: string; testId: string; ai: boolean }) {
  const t = useTranslations("report.chat");
  return (
    <div data-message className="flex items-start gap-3">
      <BeaconBotAvatar className="mt-0.5 size-9" />
      <p
        data-testid={testId}
        className={cn(bubble, "border border-surface-border bg-surface text-fg shadow-glass")}
      >
        {ai ? (
          <AiBadge state="suggested" label={t("aiBadge")} className="mb-1.5 flex" />
        ) : (
          <span className="sr-only">{t("assistant")}: </span>
        )}
        <span>{text}</span>
      </p>
    </div>
  );
}

function AnswerChip({
  label,
  quiet = false,
  ai = false,
  onClick,
}: {
  label: string;
  quiet?: boolean;
  /** One of the AI's suggested answers (focus goes to the first after a turn). */
  ai?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-chip={ai ? "ai" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium",
        "transition-colors duration-(--motion-fast) ease-standard",
        quiet
          ? "border-dashed border-control-border bg-transparent text-fg-muted hover:text-fg"
          : "border-control-border bg-surface text-fg hover:border-accent hover:text-accent",
        focusRingClass,
      )}
    >
      {label}
    </button>
  );
}
