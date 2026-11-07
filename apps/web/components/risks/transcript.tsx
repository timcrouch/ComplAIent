"use client";

import type { ConcernTranscriptDto } from "@isms/contracts";
import { AiBadge, cn } from "@isms/ui";
import { CircleHelpIcon, UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The conversation a risk was reported through, read-only. A log (with polite live updates,
 * as the chat was), the assistant's turns labelled as AI; no composer and no chips to press.
 */
export function Transcript({ transcript }: { transcript: ConcernTranscriptDto }) {
  const t = useTranslations("risks.transcript");
  if (transcript.messages.length === 0) {
    return <p className="text-[15px] text-fg-muted">{t("empty")}</p>;
  }
  return (
    <div role="log" aria-live="polite" aria-label={t("logLabel")} className="flex flex-col gap-3">
      {transcript.messages.map((m) => {
        const assistant = m.role === "assistant";
        return (
          <div
            key={m.seq}
            className={cn(
              "flex max-w-[85%] flex-col gap-1.5 rounded-lg border p-3.5",
              assistant
                ? "self-start border-surface-border bg-surface shadow-glass"
                : "self-end border-transparent bg-accent-soft",
            )}
          >
            {assistant ? (
              <AiBadge state="suggested" label={t("assistant")} />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg-muted">
                <UserRoundIcon aria-hidden className="size-3.5" />
                {t("reporter")}
              </span>
            )}
            <p className="text-[15px] leading-relaxed break-words whitespace-pre-line text-fg">
              {assistant && m.text === "" ? t("summary") : m.text}
            </p>
            {m.notSure ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg-muted">
                <CircleHelpIcon aria-hidden className="size-3.5" />
                {t("notSure")}
              </span>
            ) : null}
            {assistant && m.chips.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {m.chips.map((chip, i) => (
                  <li
                    key={i}
                    className="rounded-full border border-surface-border px-2.5 py-0.5 text-[12px] text-fg-muted"
                  >
                    {chip}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
