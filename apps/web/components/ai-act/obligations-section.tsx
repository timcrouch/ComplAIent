"use client";

import type { AiSystemDetailDto } from "@isms/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Section } from "../risks/section";
import { focusRingClass } from "../shell/styles";
import { ObligationStatusBadge } from "./badges";
import { ObligationItem } from "./obligation-item";

type Props = {
  system: AiSystemDetailDto;
  canManage: boolean;
  timeZone: string;
  onSaved: (system: AiSystemDetailDto) => void;
};

/**
 * The obligations checklist: the applicable ones first, each with its status and note; the
 * ones that no longer apply (the class or role changed) in a collapsed, greyed group whose
 * recorded work is kept.
 */
export function ObligationsSection({ system, canManage, timeZone, onSaved }: Props) {
  const t = useTranslations("aiAct.obligations");
  const tr = useTranslations("aiActRules");
  const applicable = system.obligations.filter((o) => o.applicable);
  const inapplicable = system.obligations.filter((o) => !o.applicable);

  return (
    <Section title={t("title")} intro={system.classification ? t("intro") : undefined}>
      {!system.classification ? (
        <p className="text-sm text-fg-muted">{t("none")}</p>
      ) : applicable.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("noneApply")}</p>
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-3">
          {applicable.map((obligation) => (
            <ObligationItem
              key={obligation.key}
              systemId={system.id}
              obligation={obligation}
              canManage={canManage}
              canSuggest={system.canSuggestGuidance}
              timeZone={timeZone}
              onSaved={onSaved}
            />
          ))}
        </ul>
      )}
      {inapplicable.length > 0 ? (
        <details className="group rounded-md border border-dashed border-surface-border">
          <summary
            className={`flex cursor-pointer list-none items-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-fg-muted [&::-webkit-details-marker]:hidden ${focusRingClass}`}
          >
            <ChevronRightIcon
              aria-hidden
              className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {t("notApplicable", { count: inapplicable.length })}
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4 opacity-75">
            <p className="text-[13px] text-fg-muted">{t("notApplicableHint")}</p>
            <ul className="flex flex-col gap-2">
              {inapplicable.map((o) => (
                <li
                  key={o.key}
                  data-obligation={o.key}
                  className="flex flex-col gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--isms-text)_4%,transparent)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg">
                      {tr(`obligationTitles.${o.key}`)}
                    </span>
                    <span className="text-[13px] text-fg-muted tabular-nums">{o.article}</span>
                    <ObligationStatusBadge status={o.status} />
                  </div>
                  {o.note ? (
                    <p className="text-[13px] whitespace-pre-line text-fg-muted">{o.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </Section>
  );
}
