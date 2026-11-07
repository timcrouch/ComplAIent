"use client";

import {
  conflictReasons,
  SetupStepSchema,
  type OrganisationResponse,
  type SetupStep,
} from "@isms/contracts";
import { APPETITE_PRESETS } from "@isms/domain";
import { Button, buttonVariants, cn } from "@isms/ui";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  HouseIcon,
  PartyPopperIcon,
  PencilIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { completeSetup } from "../../lib/actions/setup";
import type { CountryOption } from "../../lib/countries";
import { formatDate } from "../../lib/dates";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import { focusRingClass } from "../shell/styles";
import { useSaveFlow } from "./save-flow";
import { SETUP_STEPS, type FrameStepKey } from "./steps";

type ReviewSummaryProps = {
  organisation: OrganisationResponse;
  countries: readonly CountryOption[];
  /** The viewer's time zone, for the date setup was finished. */
  timeZone: string;
};

const isSetupStep = (value: string | null): value is SetupStep =>
  SetupStepSchema.safeParse(value).success;

/** The setup page for an API step ("riskScale" → the risk appetite step). */
const pageFor = (step: SetupStep) => SETUP_STEPS.find((s) => s.apiStep === step);

/**
 * Everything setup has saved, step by step, with a way back to each. Finish is offered only
 * when the API reports nothing missing; if the API still refuses (409), its list wins.
 */
export function ReviewSummary({ organisation, countries, timeZone }: ReviewSummaryProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const save = useSaveFlow();
  const [missing, setMissing] = useState<readonly SetupStep[]>(organisation.setup.missing);
  const [refused, setRefused] = useState(false);
  const { profile, sites, departments, frameworks, riskScale } = organisation;
  const country = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const confirmed = frameworks.filter((f) => f.status === "confirmed");
  const ready = missing.length === 0;
  // Only what the API stored: when setup was finished (it does not report by whom).
  const completedAt = organisation.setup.completedAt;

  async function finish() {
    if (!ready || save.busy) return;
    setRefused(false);
    const result = await save.run(() => completeSetup());
    if (result.ok) {
      router.push("/?setup=done");
    } else if (result.kind === "conflict") {
      const steps = conflictReasons(result.details)
        .filter((c) => c.reason === "setupIncomplete")
        .map((c) => c.item)
        .filter(isSetupStep);
      setMissing(steps);
      setRefused(true);
    } else if (result.kind === "invalid") save.setFormError("notAccepted");
  }

  const preset = riskScale
    ? (Object.keys(APPETITE_PRESETS) as (keyof typeof APPETITE_PRESETS)[]).find(
        (p) => APPETITE_PRESETS[p] === riskScale.appetiteThreshold,
      )
    : undefined;
  const notAnswered = <Empty>{t("review.notAnswered")}</Empty>;

  return (
    <div className="flex flex-col gap-6">
      {missing.length > 0 ? (
        <section
          aria-labelledby="review-missing"
          className="rounded-md border border-[color-mix(in_oklab,var(--isms-attention)_35%,transparent)] bg-attention-soft/70 p-4"
        >
          <h2 id="review-missing" className="flex items-center gap-2 text-[15px] font-bold text-fg">
            <CircleDashedIcon aria-hidden className="size-4 text-attention" />
            {t("review.missingTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-fg-muted">{t("review.missingHint")}</p>
          <ul aria-label={t("review.missingTitle")} className="mt-2 flex flex-col gap-1">
            {missing.map((step) => {
              const page = pageFor(step);
              if (!page) return null;
              return (
                <li key={step}>
                  <Link
                    href={page.path}
                    onClick={requestStepHeadingFocus}
                    className={cn(
                      "text-sm font-semibold text-accent underline underline-offset-4",
                      focusRingClass,
                    )}
                  >
                    {t(`${page.key}.title`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Section step="organisation">
          {profile ? (
            <>
              <Value strong>{profile.name}</Value>
              <Value>{profile.description}</Value>
              {profile.approximateHeadcount !== null ? (
                <Value>{t("review.headcount", { count: profile.approximateHeadcount })}</Value>
              ) : null}
            </>
          ) : (
            notAnswered
          )}
        </Section>
        <Section step="sites">
          {sites.length > 0 ? (
            <>
              <Value strong>{t("review.sites")}</Value>
              <ul className="flex flex-col gap-0.5">
                {sites.map((s) => (
                  <li key={s.id} className="text-sm text-fg">
                    {s.name} <span className="text-fg-muted">· {country(s.countryCode)}</span>
                  </li>
                ))}
              </ul>
              <Value strong>{t("review.departments")}</Value>
              {departments.length > 0 ? (
                <Value>{departments.map((d) => d.name).join(", ")}</Value>
              ) : (
                <Empty>{t("review.none")}</Empty>
              )}
            </>
          ) : (
            notAnswered
          )}
        </Section>
        <Section step="frameworks">
          {confirmed.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {confirmed.map((f) => (
                <li key={f.id} className="text-sm text-fg">
                  {f.name} {f.versionLabel}
                </li>
              ))}
            </ul>
          ) : (
            notAnswered
          )}
        </Section>
        <Section step="riskAppetite">
          {riskScale ? (
            <Value>
              {t("review.appetite", {
                preset: preset
                  ? t(`riskAppetite.presets.${preset}.label`)
                  : t("review.customAppetite"),
                threshold: riskScale.appetiteThreshold,
              })}
            </Value>
          ) : (
            notAnswered
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-3 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-6">
        {refused || save.formError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>
              {refused
                ? t("errors.setupIncomplete")
                : t(`errors.${save.formError ?? "unavailable"}`)}
            </span>
          </p>
        ) : null}
        {completedAt ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="flex items-start gap-2 text-sm font-medium text-fg sm:mr-auto">
              <CircleCheckIcon aria-hidden className="mt-px size-4 shrink-0 text-ok" />
              <span>
                {t("review.finished", {
                  date: formatDate(completedAt, timeZone),
                })}
              </span>
            </p>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
            >
              <HouseIcon aria-hidden />
              {t("review.goHome")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p id="review-finish-note" className="text-sm text-fg-muted sm:mr-auto">
              {ready ? t("review.ready") : t("review.missingHint")}
            </p>
            <Button
              type="button"
              onClick={() => void finish()}
              disabled={!ready || save.busy}
              focusableWhenDisabled
              aria-describedby="review-finish-note"
              className="w-full data-disabled:cursor-not-allowed data-disabled:opacity-50 sm:w-auto"
            >
              <PartyPopperIcon aria-hidden />
              {save.status === "saving" ? t("review.finishing") : t("review.finish")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ step, children }: { step: FrameStepKey; children: ReactNode }) {
  const t = useTranslations("setup");
  const page = SETUP_STEPS.find((s) => s.key === step);
  const title = t(`${step}.title`);
  const headingId = `review-${step}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-md border border-[color-mix(in_oklab,var(--isms-text)_9%,transparent)] bg-[color-mix(in_oklab,var(--isms-surface),transparent_35%)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">
          {title}
        </h2>
        <Link
          href={page?.path ?? "/setup"}
          onClick={requestStepHeadingFocus}
          aria-label={t("review.editStep", { step: title })}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mt-1.5 -mr-2")}
        >
          <PencilIcon aria-hidden />
          {t("review.edit")}
        </Link>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function Value({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <p
      className={cn("text-sm leading-relaxed", strong ? "font-semibold text-fg" : "text-fg-muted")}
    >
      {children}
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-fg-muted italic">{children}</p>;
}
