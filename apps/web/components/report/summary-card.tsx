"use client";

import type { ConcernDraftDto } from "@isms/contracts";
import { AiBadge, Button, Field, Input, fieldA11y } from "@isms/ui";
import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type SubmitEvent } from "react";
import {
  checkValues,
  focusFirstInvalid,
  valuesFromDraft,
  type FieldErrors,
  type ReportErrorKey,
  type ReportValues,
  type SiteOption,
} from "./report-fields";
import {
  AssetTypeSelect,
  EditableList,
  FormError,
  RemoveButton,
  SiteField,
  TextField,
} from "./report-inputs";
import type { useReportSubmit } from "./report-call";
import { useReportValues } from "./use-report-values";

type SummaryCardProps = {
  draft: ConcernDraftDto;
  sites: readonly SiteOption[];
  sender: ReturnType<typeof useReportSubmit>;
};

const MAX_ITEMS = 10;
const glass = "rounded-lg border border-surface-border bg-surface shadow-glass";

/**
 * "Here's what I understood": the AI's draft for the reporter to check and change. The AI's
 * estimate is shown, labelled, and never sent: the API takes it from the draft it stored.
 */
export function SummaryCard({ draft, sites, sender }: SummaryCardProps) {
  const t = useTranslations("report.summary");
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The card replaces the composer that had focus: take it, so it never falls to the page.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const { values, set, errors, setErrors, text } = useReportValues<ReportValues>(id, () =>
    valuesFromDraft(draft),
  );

  function show(next: FieldErrors) {
    setErrors(next);
    sender.setError("summary");
    focusFirstInvalid(formRef.current);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkValues(values);
    if (!checked.ok) {
      show(checked.errors);
      return;
    }
    setErrors({});
    const refused = await sender.submit(checked.input);
    if (refused) show(refused);
  }

  return (
    <section
      data-summary
      aria-labelledby={`${id}-heading`}
      className={`${glass} flex flex-col gap-5 p-5 sm:p-6`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            ref={headingRef}
            id={`${id}-heading`}
            tabIndex={-1}
            className="text-[20px] font-bold tracking-[-0.015em] text-fg outline-none"
          >
            {t("title")}
          </h2>
          <AiBadge state="draft" label={t("draftBadge")} />
        </div>
        <p className="max-w-[68ch] text-[14px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </div>

      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-col gap-5"
      >
        <TextField {...text("title")} label={t("titleLabel")} maxLength={120} />
        <TextField {...text("scenario")} label={t("scenarioLabel")} multiline maxLength={2000} />
        <EditableList
          legend={t("assetsLabel")}
          empty={values.assets.length === 0 ? t("noAssets") : null}
          addLabel={t("addAsset")}
          canAdd={values.assets.length < MAX_ITEMS}
          onAdd={() => {
            set("assets")([...values.assets, { name: "", type: "other" }]);
          }}
        >
          {values.assets.map((asset, i) => {
            const number = i + 1;
            const nameId = `${id}-asset-${String(i)}`;
            const error = errors[`assets.${String(i)}.name`];
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
                <ItemInput
                  id={nameId}
                  label={t("assetName", { number })}
                  error={error}
                  value={asset.name}
                  onChange={(name) => {
                    set("assets")(values.assets.map((a, j) => (j === i ? { ...a, name } : a)));
                  }}
                />
                <AssetTypeSelect
                  id={`${nameId}-type`}
                  label={t("assetType", { number })}
                  value={asset.type}
                  onChange={(type) => {
                    set("assets")(values.assets.map((a, j) => (j === i ? { ...a, type } : a)));
                  }}
                />
                <RemoveButton
                  label={t("removeAsset", { number })}
                  onClick={() => {
                    set("assets")(values.assets.filter((_, j) => j !== i));
                  }}
                />
              </div>
            );
          })}
        </EditableList>
        <TextField {...text("threat")} label={t("threatLabel")} multiline maxLength={1000} />
        <TextField
          {...text("consequence")}
          label={t("consequenceLabel")}
          multiline
          maxLength={1000}
        />
        <TextField
          {...text("existingSafeguards")}
          label={t("safeguardsLabel")}
          hint={t("safeguardsHint")}
          multiline
          maxLength={1000}
        />
        <SiteField
          id={`${id}-site`}
          label={t("siteLabel")}
          sites={sites}
          value={values.siteId}
          onChange={set("siteId")}
        />
        <EditableList
          legend={t("toConfirmLabel")}
          hint={t("toConfirmHint")}
          empty={values.toConfirm.length === 0 ? t("noToConfirm") : null}
          addLabel={t("addToConfirm")}
          canAdd={values.toConfirm.length < MAX_ITEMS}
          onAdd={() => {
            set("toConfirm")([...values.toConfirm, ""]);
          }}
        >
          {values.toConfirm.map((item, i) => {
            const number = i + 1;
            return (
              <div key={i} className="flex items-start gap-2">
                <ItemInput
                  id={`${id}-confirm-${String(i)}`}
                  label={t("toConfirmItem", { number })}
                  error={errors[`toConfirm.${String(i)}`]}
                  value={item}
                  onChange={(next) => {
                    set("toConfirm")(values.toConfirm.map((c, j) => (j === i ? next : c)));
                  }}
                />
                <RemoveButton
                  label={t("removeToConfirm", { number })}
                  onClick={() => {
                    set("toConfirm")(values.toConfirm.filter((_, j) => j !== i));
                  }}
                />
              </div>
            );
          })}
        </EditableList>

        <Estimate estimate={draft.aiEstimate} />
        <FormError error={sender.error} />
        <Button type="submit" className="self-start" disabled={sender.busy}>
          <SendIcon aria-hidden />
          {sender.busy ? t("sending") : t("submit")}
        </Button>
      </form>
    </section>
  );
}

/** A list row's input, labelled for screen readers by its number ("Thing to confirm 2"). */
function ItemInput({
  id,
  label,
  error,
  value,
  onChange,
}: {
  id: string;
  label: string;
  error: ReportErrorKey | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("report.errors");
  const message = error ? t(error) : undefined;
  return (
    <Field
      id={id}
      label={<span className="sr-only">{label}</span>}
      error={message}
      className="min-w-0 flex-1"
    >
      <Input
        id={id}
        maxLength={300}
        value={value}
        onValueChange={onChange}
        {...fieldA11y(id, { hint: false, error: message })}
      />
    </Field>
  );
}

function Estimate({ estimate }: { estimate: ConcernDraftDto["aiEstimate"] }) {
  const t = useTranslations("report.summary");
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-control-border p-4">
      <AiBadge state="suggested" label={t("estimateBadge")} />
      {estimate ? (
        <>
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] font-semibold text-fg">
            <span>{t("estimateLikely", { value: estimate.likelihood })}</span>
            <span>{t("estimateImpact", { value: estimate.impact })}</span>
          </p>
          {estimate.reasoning ? (
            <p className="text-[13px] leading-relaxed text-fg-muted">{estimate.reasoning}</p>
          ) : null}
          <p className="text-[13px] leading-relaxed text-fg-muted">{t("estimateNote")}</p>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-fg-muted">{t("noEstimate")}</p>
      )}
    </div>
  );
}
