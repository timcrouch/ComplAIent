"use client";

import type { RiskScaleDto } from "@isms/contracts";
import { isAboveAppetite, riskScore } from "@isms/domain";
import { ABOVE_APPETITE_CELL, AboveAppetiteIcon, cn } from "@isms/ui";
import { CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

type AppetiteGridProps = { scale: RiskScaleDto; threshold: number };

const cellBase =
  "flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-sm px-1 py-2 text-center transition-colors duration-(--motion-base) ease-standard";

/**
 * Every likelihood × impact combination, judged against `threshold`, as a real table: impact
 * labels head the rows (most severe first), likelihood labels head the columns. Each cell
 * says in words and with an icon whether it is within appetite; colour only repeats that.
 * A preview: the API decides for real (P2-R9).
 */
export function AppetiteGrid({ scale, threshold }: AppetiteGridProps) {
  const t = useTranslations("setup.riskAppetite");
  const impacts = [...scale.impact].sort((a, b) => b.value - a.value);
  const likelihoods = [...scale.likelihood].sort((a, b) => a.value - b.value);

  return (
    <div className="flex flex-col gap-2">
      {/* The caption, shown outside the scrolling table so it is never cut off on a phone. */}
      <p aria-hidden className="text-[13px] leading-relaxed text-fg-muted">
        {t("caption")}
      </p>
      <p aria-hidden className="text-xs font-medium text-fg-muted sm:hidden">
        {t("scrollHint")}
      </p>
      {/* Scrolls sideways on narrow screens; focusable so keyboard users can scroll it too. */}
      <div
        role="region"
        aria-label={t("gridLabel")}
        tabIndex={0}
        className="-mx-1 overflow-x-auto rounded-md px-1 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <table className="w-full min-w-[440px] border-separate border-spacing-1 text-fg sm:border-spacing-1.5">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr>
              <td />
              <th
                scope="colgroup"
                colSpan={likelihoods.length}
                className="pb-1 text-left text-xs font-bold tracking-[0.08em] text-fg-muted uppercase"
              >
                {t("likelihood")}
              </th>
            </tr>
            <tr>
              <th
                scope="col"
                className="w-[84px] pb-1 text-left sm:w-[112px] text-xs font-bold tracking-[0.08em] text-fg-muted uppercase"
              >
                {t("impact")}
              </th>
              {likelihoods.map((l) => (
                <th
                  key={l.value}
                  scope="col"
                  className="pb-1 text-xs leading-tight font-semibold text-fg"
                >
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {impacts.map((impact) => (
              <tr key={impact.value}>
                <th scope="row" className="pr-2 text-left text-xs leading-tight font-semibold">
                  {impact.label}
                </th>
                {likelihoods.map((likelihood) => {
                  const score = riskScore(likelihood.value, impact.value);
                  const above = isAboveAppetite(score, threshold);
                  const Icon = above ? AboveAppetiteIcon : CircleCheckIcon;
                  return (
                    <td key={likelihood.value} className="p-0">
                      <div
                        data-above={above || undefined}
                        className={cn(cellBase, above ? ABOVE_APPETITE_CELL : "bg-ok-soft text-ok")}
                      >
                        <span className="text-base leading-none font-bold tabular-nums">
                          {score}
                        </span>
                        <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
                        <span className="text-[11px] leading-tight font-semibold">
                          {above ? t("above") : t("within")}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
