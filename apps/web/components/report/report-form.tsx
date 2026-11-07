"use client";

import { Button } from "@isms/ui";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import type { useReportSubmit } from "./report-call";
import {
  checkValues,
  focusFirstInvalid,
  type FieldErrors,
  type ReportValues,
  type SiteOption,
} from "./report-fields";
import { AssetTypeSelect, FormError, SiteField, TextField } from "./report-inputs";
import { useReportValues } from "./use-report-values";

/** The conversation's questions as steps, with the fields each one fills. */
const STEPS = [
  { key: "worry", fields: ["title", "scenario"] },
  { key: "site", fields: ["siteId"] },
  { key: "affected", fields: ["assets"] },
  { key: "cause", fields: ["threat", "consequence"] },
  { key: "safeguards", fields: ["existingSafeguards"] },
] as const;

type FormValues = Omit<ReportValues, "assets"> & {
  asset: { name: string; type: ReportValues["assets"][number]["type"] };
};

/** One affected thing in the form; an empty name means none was named. */
const toValues = ({ asset, ...rest }: FormValues): ReportValues => ({
  ...rest,
  assets: asset.name.trim() === "" ? [] : [asset],
});

const stepOf = (path: string): number =>
  Math.max(
    0,
    STEPS.findIndex((s) => (s.fields as readonly string[]).includes(path.split(".")[0] ?? "")),
  );

type ReportFormProps = {
  sites: readonly SiteOption[];
  initial: ReportValues;
  /** The assistant could not continue: say so once, above the form. */
  fallback: boolean;
  /** Take focus on the first question when shown (after a failed turn, or a new report). */
  focusOnMount?: boolean;
  sender: ReturnType<typeof useReportSubmit>;
};

/** The report as a step form: for AI off, `?mode=form`, or after a failed turn. */
export function ReportForm({
  sites,
  initial,
  fallback,
  focusOnMount = false,
  sender,
}: ReportFormProps) {
  const t = useTranslations("report.form");
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const legendRef = useRef<HTMLHeadingElement>(null);
  // Shown in place of the conversation or the done panel: focus its question.
  const moved = useRef(fallback || focusOnMount);
  const [step, setStep] = useState(0);
  const [announced, setAnnounced] = useState(false);
  const { values, set, errors, setErrors, text } = useReportValues<FormValues>(id, () => ({
    ...initial,
    asset: initial.assets[0] ?? { name: "", type: "other" },
  }));

  // After Back or Next, focus the new step's question so it is read out.
  useEffect(() => {
    if (moved.current) legendRef.current?.focus();
  }, [step, announced]);

  useEffect(() => {
    setAnnounced(true);
  }, []);

  function go(next: number) {
    moved.current = true;
    sender.setError(null);
    setStep(next);
  }

  function show(next: FieldErrors) {
    setErrors(next);
    const first = Object.keys(next)[0];
    const target = first === undefined ? step : stepOf(first);
    if (target !== step) go(target);
    sender.setError("summary");
    focusFirstInvalid(formRef.current);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkValues(toValues(values));
    const current = STEPS[step]?.fields ?? [];
    const here = checked.ok
      ? {}
      : Object.fromEntries(
          Object.entries(checked.errors).filter(([path]) =>
            (current as readonly string[]).includes(path.split(".")[0] ?? ""),
          ),
        );
    if (Object.keys(here).length > 0) {
      show(here);
      return;
    }
    setErrors({});
    if (step < STEPS.length - 1) {
      go(step + 1);
      return;
    }
    if (!checked.ok) {
      show(checked.errors);
      return;
    }
    const refused = await sender.submit(checked.input);
    if (refused) show(refused);
  }

  const current = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;

  return (
    <div className="flex flex-col gap-5">
      {fallback ? (
        // A status region that exists before its text, so the switch is announced; the focused
        // question is also described by it.
        <p
          role="status"
          className={
            announced
              ? "flex items-start gap-2.5 rounded-md bg-info-soft px-4 py-3 text-sm font-medium text-info"
              : "sr-only"
          }
        >
          {announced ? (
            <>
              <InfoIcon aria-hidden className="mt-px size-4 shrink-0" />
              <span id={`${id}-fallback`}>{t("fallback")}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-col gap-6 rounded-lg border border-surface-border bg-surface p-5 shadow-glass sm:p-6"
      >
        <div role="group" aria-labelledby={`${id}-question`} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold text-accent">
              {t("step", { current: step + 1, total: STEPS.length })}
            </p>
            <h2
              ref={legendRef}
              id={`${id}-question`}
              tabIndex={-1}
              aria-describedby={fallback && announced ? `${id}-fallback` : undefined}
              className="text-[20px] font-bold tracking-[-0.015em] text-fg outline-none"
            >
              {t(`${current.key}Legend`)}
            </h2>
          </div>
          {current.key === "worry" ? (
            <>
              <TextField
                {...text("title")}
                label={t("titleLabel")}
                hint={t("titleHint")}
                maxLength={120}
              />
              <TextField
                {...text("scenario")}
                label={t("scenarioLabel")}
                multiline
                maxLength={2000}
              />
            </>
          ) : null}
          {current.key === "site" ? (
            <SiteField
              id={`${id}-site`}
              label={t("siteLabel")}
              sites={sites}
              value={values.siteId}
              onChange={set("siteId")}
            />
          ) : null}
          {current.key === "affected" ? (
            <>
              <TextField
                id={`${id}-asset`}
                label={t("assetLabel")}
                hint={t("affectedHint")}
                error={errors["assets.0.name"]}
                value={values.asset.name}
                onChange={(name) => {
                  set("asset")({ ...values.asset, name });
                }}
                maxLength={120}
              />
              <AssetTypeSelect
                id={`${id}-asset-type`}
                label={t("assetTypeLabel")}
                value={values.asset.type}
                onChange={(type) => {
                  set("asset")({ ...values.asset, type });
                }}
              />
            </>
          ) : null}
          {current.key === "cause" ? (
            <>
              <TextField {...text("threat")} label={t("threatLabel")} multiline maxLength={1000} />
              <TextField
                {...text("consequence")}
                label={t("consequenceLabel")}
                multiline
                maxLength={1000}
              />
            </>
          ) : null}
          {current.key === "safeguards" ? (
            <TextField
              {...text("existingSafeguards")}
              label={t("safeguardsLabel")}
              hint={t("safeguardsHint")}
              multiline
              maxLength={1000}
            />
          ) : null}
        </div>

        <FormError error={sender.error} />
        <div className="flex flex-wrap items-center gap-3">
          {step > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                go(step - 1);
              }}
            >
              <ArrowLeftIcon aria-hidden />
              {t("back")}
            </Button>
          ) : null}
          <Button type="submit" className="ml-auto" disabled={sender.busy}>
            {last ? <SendIcon aria-hidden /> : null}
            {last ? (sender.busy ? t("sending") : t("submit")) : t("next")}
            {last ? null : <ArrowRightIcon aria-hidden />}
          </Button>
        </div>
      </form>
    </div>
  );
}
