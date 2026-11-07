"use client";

import { buttonVariants } from "@isms/ui";
import { CheckIcon, CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { updateRisk } from "../../lib/actions/risks";
import { useRisk } from "./risk-context";
import { Section } from "./section";
import { useControlAction } from "./use-control-action";

/**
 * Questions the reporter wasn't sure about (P3-R6). "Resolved" removes one by editing
 * `toConfirm`; focus moves to the next item, or the heading when none is left.
 */
export function ToConfirmSection() {
  const t = useTranslations("risks.toConfirm");
  const { risk } = useRisk();
  const { busy, run, notices } = useControlAction();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const items = risk.toConfirm;

  useEffect(() => {
    if (focusIndex === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    const next = buttons[Math.min(focusIndex, buttons.length - 1)];
    if (next) next.focus();
    else headingRef.current?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  async function resolve(index: number) {
    const done = await run(
      (version) => updateRisk(risk.id, version, { toConfirm: items.filter((_, i) => i !== index) }),
      () => t("done"),
    );
    if (done) setFocusIndex(index);
  }

  return (
    <Section title={t("title")} intro={t("intro")} headingRef={headingRef}>
      {items.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{t("none")}</p>
      ) : (
        <ul ref={listRef} aria-label={t("listLabel")} className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li
              key={`${String(i)}-${item}`}
              className="flex flex-col gap-2 rounded-md border border-surface-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex items-start gap-2 text-[14px] text-fg">
                <CircleHelpIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-attention" />
                {item}
              </span>
              {risk.can.edit ? (
                <button
                  type="button"
                  aria-disabled={busy || undefined}
                  aria-label={t("resolvedLabel", { item })}
                  onClick={() => void resolve(i)}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <CheckIcon aria-hidden />
                  {t("resolved")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {notices(() => headingRef.current?.focus())}
    </Section>
  );
}
