"use client";

import type { AiSystemSummaryDto } from "@isms/contracts";
import { AI_RISK_CLASSES } from "@isms/domain";
import { buttonVariants, cn } from "@isms/ui";
import { ArrowRightIcon, InfoIcon, PlusIcon, ScaleIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";
import { glass } from "../setup/styles";
import { ClassBadge } from "./badges";
import { ModuleHeader } from "./module-header";

/** Whether to say the EU AI Act framework is not in scope, and if so whether to link Setup. */
export type FrameworkHint = "none" | "link" | "ask";

type Props = {
  systems: readonly AiSystemSummaryDto[];
  canManage: boolean;
  frameworkHint: FrameworkHint;
};

const COLUMNS = ["name", "role", "status", "class", "owner", "open"] as const;

/** Counts from the register as the API returned it; nothing is estimated. */
function counts(systems: readonly AiSystemSummaryDto[]) {
  const byClass = Object.fromEntries(
    AI_RISK_CLASSES.map((c) => [c, systems.filter((s) => s.riskClass === c).length]),
  ) as Record<(typeof AI_RISK_CLASSES)[number], number>;
  return {
    byClass,
    unclassified: systems.filter((s) => s.riskClass === "unclassified").length,
    openHighRisk: systems
      .filter((s) => s.riskClass === "high_risk")
      .reduce((sum, s) => sum + s.openObligationCount, 0),
  };
}

/** The EU AI Act overview: the counts, the framework hint and the register. */
export function AiActOverview({ systems, canManage, frameworkHint }: Props) {
  const t = useTranslations("aiAct.overview");
  const tc = useTranslations("aiAct.classes");
  const add = canManage ? (
    <Link href="/ai-act/systems/new" className={buttonVariants()}>
      <PlusIcon aria-hidden />
      {t("add")}
    </Link>
  ) : null;
  const c = counts(systems);

  return (
    <div className="flex flex-col gap-6">
      <ModuleHeader title={t("title")} intro={t("intro")} actions={add} />

      {frameworkHint !== "none" ? (
        <aside className="flex items-start gap-2.5 rounded-md bg-info-soft/70 px-4 py-3 text-sm text-fg">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <p className="flex flex-col gap-1">
            <span>{frameworkHint === "link" ? t("frameworkHint") : t("frameworkHintAsk")}</span>
            {frameworkHint === "link" ? (
              <Link
                href="/setup/frameworks"
                className={cn(
                  "w-fit rounded-sm font-semibold text-accent underline underline-offset-4",
                  focusRingClass,
                )}
              >
                {t("frameworkHintLink")}
              </Link>
            ) : null}
          </p>
        </aside>
      ) : null}

      {systems.length === 0 ? (
        <section
          aria-labelledby="ai-act-empty"
          className={cn(glass, "flex flex-col items-start gap-3 p-6 sm:p-8")}
        >
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
            <ScaleIcon aria-hidden className="size-5" />
          </span>
          <h2 id="ai-act-empty" className="text-lg font-bold text-fg">
            {t("empty.title")}
          </h2>
          <p className="max-w-[60ch] text-sm leading-relaxed text-fg-muted">{t("empty.body")}</p>
          {canManage ? (
            <Link href="/ai-act/systems/new" className={buttonVariants()}>
              <PlusIcon aria-hidden />
              {t("empty.add")}
            </Link>
          ) : (
            <p className="text-sm text-fg">{t("empty.ask")}</p>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="ai-act-counts" className="flex flex-col gap-3">
            <h2 id="ai-act-counts" className="sr-only">
              {t("countsLabel")}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              <Tile label={t("unclassified")} value={c.unclassified} />
              <Tile label={t("openHighRisk")} value={c.openHighRisk} />
            </ul>
            <ul aria-label={t("byClass")} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {AI_RISK_CLASSES.map((riskClass) => (
                <li
                  key={riskClass}
                  className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface px-3 py-2"
                >
                  <span className="text-[13px] text-fg-muted">{tc(riskClass)}</span>
                  <span className="text-lg font-semibold text-fg tabular-nums">
                    {c.byClass[riskClass]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <Register systems={systems} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <li className={cn(glass, "flex flex-col gap-1 p-4")}>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="text-[28px] leading-none font-semibold text-fg tabular-nums">{value}</span>
    </li>
  );
}

function Register({ systems }: { systems: readonly AiSystemSummaryDto[] }) {
  const t = useTranslations("aiAct");
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface shadow-glass">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">{t("overview.tableCaption")}</caption>
        <thead>
          <tr className="text-[12px] font-semibold tracking-wide text-fg-muted uppercase">
            {COLUMNS.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn("px-4 py-2.5", column === "open" && "text-right")}
              >
                {t(`overview.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {systems.map((s) => (
            <tr key={s.id} className="border-t border-surface-border align-middle">
              <th scope="row" className="px-4 py-3 font-semibold">
                <Link
                  href={`/ai-act/systems/${s.id}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm text-accent underline-offset-4 hover:underline",
                    focusRingClass,
                  )}
                >
                  {s.name}
                  <ArrowRightIcon aria-hidden className="size-3.5" />
                </Link>
              </th>
              <td className="px-4 py-3 text-fg">{t(`roles.${s.role}`)}</td>
              <td className="px-4 py-3 text-fg">{t(`statuses.${s.status}`)}</td>
              <td className="px-4 py-3">
                <ClassBadge riskClass={s.riskClass} />
              </td>
              <td className="px-4 py-3 text-fg">{s.owner.displayName}</td>
              <td className="px-4 py-3 text-right font-semibold text-fg tabular-nums">
                {s.openObligationCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
