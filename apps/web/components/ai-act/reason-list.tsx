"use client";

import type { AiClassificationResultDto } from "@isms/contracts";
import { useTranslations } from "next-intl";
import { isReasonCode } from "./reason-codes";

/** Why a system has its class: each reason as a plain sentence, with its article. */
export function ReasonList({
  reasons,
  labelledBy,
}: {
  reasons: AiClassificationResultDto["reasons"];
  labelledBy?: string;
}) {
  const t = useTranslations("aiActRules.reasons");
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col gap-2">
      {reasons.map((reason, i) => (
        // Reasons never reorder, and an unknown code may repeat: key by position.
        <li
          key={i}
          className="flex flex-col gap-0.5 text-sm leading-relaxed text-fg sm:flex-row sm:gap-3"
        >
          <span className="min-w-0 flex-1">
            {isReasonCode(reason.code) ? t(reason.code) : t("unknown")}
          </span>
          <span className="shrink-0 text-[13px] font-semibold text-fg-muted tabular-nums">
            {reason.article}
          </span>
        </li>
      ))}
    </ul>
  );
}
