"use client";

import type { RiskControlDto } from "@isms/contracts";
import { AiBadge, buttonVariants, Input } from "@isms/ui";
import { CheckIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { decideControl } from "../../lib/actions/risks";
import { useRisk } from "./risk-context";
import { useControlAction } from "./use-control-action";

const list = new Intl.ListFormat("en-GB", { style: "short", type: "unit" });

/** "Mapped to iso27001-2022 A.5.9, …" — references only, never requirement text. */
export function ControlRefs({ control }: { control: RiskControlDto }) {
  const t = useTranslations("risks.controls");
  if (control.refs.length === 0) return null;
  const refs = list.format(control.refs.map((r) => t("ref", r)));
  return <p className="text-[13px] text-fg-muted">{t("refs", { refs })}</p>;
}

/**
 * The AI's suggestions, each labelled, with Accept or Reject and an optional reason. After a
 * decision the card goes; focus moves to the next suggestion, or the heading when none is left.
 */
export function SuggestionList() {
  const t = useTranslations("risks.controls");
  const { risk } = useRisk();
  const { busy, run, notices } = useControlAction();
  const id = useId();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const suggestions = risk.controls.filter((c) => c.status === "suggested");

  useEffect(() => {
    if (focusIndex === null) return;
    const accepts = listRef.current?.querySelectorAll<HTMLElement>("[data-accept]") ?? [];
    const next = accepts[Math.min(focusIndex, accepts.length - 1)];
    if (next) next.focus();
    else headingRef.current?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  async function decide(index: number, control: RiskControlDto, decision: "accept" | "reject") {
    const done = await run(
      (version) => decideControl(risk.id, control.id, version, decision, reasons[control.id]),
      () => t(decision === "accept" ? "accepted" : "rejected", { code: control.code }),
    );
    if (done) setFocusIndex(index);
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-fg outline-none">
        {t("suggestedTitle")}
      </h3>
      {suggestions.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{t("noSuggestions")}</p>
      ) : (
        <ul ref={listRef} aria-label={t("suggestionsLabel")} className="flex flex-col gap-3">
          {suggestions.map((control, i) => {
            const reasonId = `${id}-${control.id}`;
            return (
              <li
                key={control.id}
                className="flex flex-col gap-2 rounded-md border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_35%,transparent)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span data-control-code className="font-semibold text-fg tabular-nums">
                    {control.code}
                  </span>
                  <span className="text-fg">{control.title}</span>
                  <AiBadge state="suggested" label={t("suggestedBadge")} />
                </div>
                <p className="text-[14px] leading-relaxed text-fg">{control.reason}</p>
                <ControlRefs control={control} />
                {risk.can.edit ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <label htmlFor={reasonId} className="text-[13px] font-semibold text-fg">
                        {t("reasonLabel", { code: control.code })}
                      </label>
                      <Input
                        id={reasonId}
                        maxLength={300}
                        value={reasons[control.id] ?? ""}
                        onChange={(e) => {
                          setReasons({ ...reasons, [control.id]: e.target.value });
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-accept
                        aria-disabled={busy || undefined}
                        onClick={() => void decide(i, control, "accept")}
                        className={buttonVariants({ size: "md" })}
                      >
                        <CheckIcon aria-hidden />
                        {t("accept")} <span className="sr-only">{control.code}</span>
                      </button>
                      <button
                        type="button"
                        aria-disabled={busy || undefined}
                        onClick={() => void decide(i, control, "reject")}
                        className={buttonVariants({ variant: "secondary", size: "md" })}
                      >
                        <XIcon aria-hidden />
                        {t("reject")} <span className="sr-only">{control.code}</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {notices(() => headingRef.current?.focus())}
    </div>
  );
}
