import type { PersonRef, RiskJourneyDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { CheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";

const STATUS_ICON = { done: CheckIcon, current: CircleDotIcon, upcoming: CircleIcon } as const;

type RiskJourneyProps = {
  journey: RiskJourneyDto;
  timeZone: string;
  /** Injectable clock, for tests. */
  now?: Date;
};

/** Whole units since `since`: days, else hours, else minutes. */
function elapsed(
  since: string,
  now: Date,
): { unit: "day" | "hour" | "minute" | "none"; count: number } {
  const minutes = Math.floor((now.getTime() - new Date(since).getTime()) / 60_000);
  if (minutes >= 1440) return { unit: "day", count: Math.floor(minutes / 1440) };
  if (minutes >= 60) return { unit: "hour", count: Math.floor(minutes / 60) };
  if (minutes >= 1) return { unit: "minute", count: minutes };
  return { unit: "none", count: 0 };
}

/**
 * The steps from report to treated, in words, icons and `aria-current`: who the risk
 * waits on and for how long, and every return with its comment. Horizontal from `sm`.
 */
export function RiskJourney({ journey, timeZone, now }: RiskJourneyProps) {
  const t = useTranslations("insights.journey");
  const ta = useTranslations("approval");
  const waiting = journey.waitingOn;
  const { unit, count } = elapsed(journey.since, now ?? new Date());

  let waitText: string | null = null;
  let waitTone: "plain" | "alert" = "plain";
  if (waiting.kind === "owner") {
    waitText = waiting.owner
      ? t("waitingOwner", { name: waiting.owner.displayName })
      : t("noOwner");
  } else if (waiting.kind === "approver") {
    if (waiting.noEligibleApprover) {
      waitText = ta("noEligibleApprover");
      waitTone = "alert";
    } else if (waiting.rule === "reviewerMayApprove") {
      waitText = t("ruleReviewerMayApprove", { name: waiting.reviewer.displayName });
    } else {
      // Names go only to people who review or approve; for everyone else the list is empty.
      const names = waiting.eligibleApprovers.map((p: PersonRef) => p.displayName).join(", ");
      const more = waiting.eligibleApproverCount - waiting.eligibleApprovers.length;
      waitText =
        names === ""
          ? t("ruleIndependentNoNames")
          : t("ruleIndependent", {
              names: more > 0 ? t("andMore", { names, count: more }) : names,
            });
    }
  } else if (waiting.kind === "review") {
    waitText = waiting.nextReviewDue
      ? t("reviewDue", { date: formatDate(waiting.nextReviewDue, "UTC") })
      : t("reviewNoDate");
  }

  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={t("label")} className="flex flex-col gap-3 sm:flex-row sm:gap-2">
        {journey.steps.map((step, index) => {
          const Icon = STATUS_ICON[step.status];
          return (
            <li
              key={step.key}
              aria-current={step.status === "current" ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-1 gap-2.5 rounded-md border p-3 sm:flex-col",
                step.status === "current"
                  ? "border-accent bg-accent-soft"
                  : "border-surface-border bg-surface",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  step.status === "upcoming" ? "text-fg-muted" : "text-accent",
                )}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-fg">
                  {index === 0 && journey.cycle === "reassessed"
                    ? t("reassessed")
                    : t(`steps.${step.key}`)}
                </span>
                <span className="text-xs font-semibold text-fg-muted">
                  {t(`status.${step.status}`)}
                </span>
                {step.status === "done" && step.at ? (
                  <span className="text-xs break-words text-fg-muted">
                    {step.by
                      ? t("stepBy", {
                          date: formatDate(step.at, timeZone),
                          name: step.by.displayName,
                        })
                      : formatDate(step.at, timeZone)}
                  </span>
                ) : null}
                {step.status === "current" && waitText ? (
                  <span
                    className={cn(
                      "text-xs break-words",
                      waitTone === "alert" ? "font-semibold text-fg" : "text-fg-muted",
                    )}
                  >
                    {waitText}
                  </span>
                ) : null}
                {step.status === "current" && waiting.kind !== "review" ? (
                  <span suppressHydrationWarning className="text-xs text-fg-muted">
                    {t("waiting", { unit, count })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {journey.returnCount > 0 ? (
        <details className="text-sm text-fg">
          <summary className="cursor-pointer font-semibold">
            {t("returned", { count: journey.returnCount })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-fg-muted">
            {journey.returns.map((r) => (
              <li key={`${r.at}-${r.by.id}`}>
                {t("returnLine", {
                  date: formatDate(r.at, timeZone),
                  name: r.by.displayName,
                  comment: r.comment,
                })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
