"use client";

import type { SecurityContributionDto } from "@isms/contracts";
import { AwardIcon, RefreshCwIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { glass } from "../setup/styles";

export function SecurityContributionView({
  contribution,
}: {
  contribution: SecurityContributionDto;
}) {
  const t = useTranslations("rewards");
  const router = useRouter();
  const nextPoints = contribution.rank.next
    ? contribution.rank.next.minimumPoints - contribution.points.total
    : null;
  return (
    <div className="flex flex-col gap-5">
      {!contribution.enabled ? (
        <p className="rounded-xl bg-attention-soft px-4 py-3 text-sm font-medium text-fg">
          {t("disabled")}
        </p>
      ) : null}
      <section className={`${glass} overflow-hidden p-5 sm:p-7`}>
        <div className="grid items-center gap-6 sm:grid-cols-[160px_1fr]">
          <div className="relative mx-auto size-36 motion-safe:animate-[pulse_2.4s_ease-in-out_1]">
            <Image
              src={`/images/concern-rewards/ranks/${contribution.rank.key.replaceAll("_", "-")}.png`}
              alt=""
              fill
              sizes="144px"
              className="object-contain drop-shadow-[0_12px_28px_color-mix(in_oklab,var(--isms-accent)_28%,transparent)]"
              priority
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-semibold tracking-[0.12em] text-fg-muted uppercase">
              {t("rank")}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.03em] text-fg">
              {contribution.rank.label}
            </h2>
            <p className="text-xl font-bold text-accent">
              {t("points", { points: contribution.points.total })}
            </p>
            {contribution.points.provisional !== 0 ? (
              <p className="text-sm text-fg-muted">
                {t("provisional", { points: contribution.points.provisional })}
              </p>
            ) : null}
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-control-hover">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700 motion-reduce:transition-none"
                style={{
                  width: contribution.rank.next
                    ? `${String(Math.min(100, ((contribution.points.total - contribution.rank.minimumPoints) / (contribution.rank.next.minimumPoints - contribution.rank.minimumPoints)) * 100))}%`
                    : "100%",
                }}
              />
            </div>
            <p className="text-xs font-medium text-fg-muted">
              {contribution.rank.next && nextPoints !== null
                ? t("nextRank", { points: nextPoints, rank: contribution.rank.next.label })
                : t("topRank")}
            </p>
          </div>
        </div>
      </section>

      <section className={`${glass} flex flex-col gap-4 p-5 sm:p-6`}>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <AwardIcon aria-hidden className="size-5 text-accent" />
          {t("badges")}
        </h2>
        {contribution.badges.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("noBadges")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contribution.badges.map((badge) => (
              <li
                key={badge.key}
                className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface/70 p-3 motion-safe:animate-[fade-in_500ms_ease-out_both]"
              >
                <Image
                  src={badge.image}
                  alt=""
                  width={64}
                  height={64}
                  className="size-16 object-contain"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-fg">{badge.title}</p>
                    {badge.repeatable ? (
                      <span
                        aria-label={t("earnedTimes", { count: badge.count })}
                        title={t("earnedTimes", { count: badge.count })}
                        className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent"
                      >
                        ×{badge.count}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs leading-relaxed text-fg-muted">{badge.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${glass} flex flex-col gap-4 p-5 sm:p-6`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <ShieldCheckIcon aria-hidden className="size-5 text-accent" />
            {t("recent")}
          </h2>
          <button
            type="button"
            onClick={() => {
              router.refresh();
            }}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-accent hover:bg-accent-soft"
          >
            <RefreshCwIcon aria-hidden className="size-4" />
            {t("refresh")}
          </button>
        </div>
        {contribution.recent.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("noRecent")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {contribution.recent.map((evaluation) => {
              const highImpact =
                evaluation.severity === "major" || evaluation.severity === "critical";
              return (
                <li
                  key={evaluation.id}
                  className="rounded-xl border border-surface-border bg-surface/60 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-fg">{evaluation.riskReference}</p>
                      <p className="text-xs font-semibold text-fg-muted">
                        {t(`status.${evaluation.status}`)}
                      </p>
                    </div>
                    <p className="text-lg font-bold text-accent">+{evaluation.points.total}</p>
                  </div>
                  {evaluation.legitimacy && evaluation.severity ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <p
                        className={`flex items-center gap-2 text-sm font-semibold ${highImpact ? "text-attention" : "text-ok"}`}
                      >
                        {highImpact ? (
                          <ShieldCheckIcon aria-hidden className="size-4" />
                        ) : (
                          <SparklesIcon aria-hidden className="size-4" />
                        )}
                        {highImpact ? t("highImpact") : t(`legitimacy.${evaluation.legitimacy}`)}
                      </p>
                      <p className="text-sm text-fg-muted">
                        {t(`severity.${evaluation.severity}`)}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {t("breakdown", {
                          legitimacy: evaluation.points.legitimacy,
                          severity: evaluation.points.severity,
                          position: evaluation.points.position,
                        })}
                      </p>
                      {evaluation.feedback ? (
                        <p className="text-sm leading-relaxed text-fg">{evaluation.feedback}</p>
                      ) : null}
                      {evaluation.status === "provisional" ? (
                        <p className="text-xs font-medium text-fg-muted">{t("reviewNotice")}</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
