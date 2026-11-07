"use client";

import { Button, Field, fieldA11y, Input, Select, Textarea } from "@isms/ui";
import { CircleAlertIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ASSET_TYPES,
  type ReportErrorKey,
  type ReportValues,
  type SiteOption,
} from "./report-fields";

type TextFieldProps = {
  id: string;
  label: string;
  hint?: string | undefined;
  error: ReportErrorKey | undefined;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength: number;
};

/** One labelled text answer with its hint and its error (icon and words, linked). */
export function TextField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  multiline = false,
  maxLength,
}: TextFieldProps) {
  const t = useTranslations("report.errors");
  const message = error ? t(error) : undefined;
  const a11y = fieldA11y(id, { hint, error: message });
  return (
    <Field id={id} label={label} hint={hint} error={message}>
      {multiline ? (
        <Textarea
          id={id}
          rows={3}
          maxLength={maxLength}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          {...a11y}
        />
      ) : (
        <Input id={id} maxLength={maxLength} value={value} onValueChange={onChange} {...a11y} />
      )}
    </Field>
  );
}

/** The site, or "not sure" (sent as no site). */
export function SiteField({
  id,
  label,
  sites,
  value,
  onChange,
}: {
  id: string;
  label: string;
  sites: readonly SiteOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("report.site");
  return (
    <Field id={id} label={label}>
      <Select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">{t("none")}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The kind of an affected thing, in plain words. */
export function AssetTypeSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: ReportValues["assets"][number]["type"];
  onChange: (value: ReportValues["assets"][number]["type"]) => void;
  label: string;
}) {
  const t = useTranslations("report.assetTypes");
  return (
    <Field id={id} label={label}>
      <Select
        id={id}
        value={value}
        onChange={(e) => {
          const next = ASSET_TYPES.find((type) => type === e.target.value);
          if (next) onChange(next);
        }}
      >
        {ASSET_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(type)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A list the reporter can add to and remove from, under a legend. */
export function EditableList({
  legend,
  hint,
  empty,
  addLabel,
  onAdd,
  canAdd,
  children,
}: {
  legend: string;
  hint?: string;
  empty: string | null;
  addLabel: string;
  onAdd: () => void;
  canAdd: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-fg">{legend}</legend>
      {hint ? <p className="-mt-1 text-[13px] leading-relaxed text-fg-muted">{hint}</p> : null}
      {empty ? <p className="text-[13px] text-fg-muted">{empty}</p> : children}
      {canAdd ? (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onAdd}>
          <PlusIcon aria-hidden />
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

/** Removes one row of an EditableList; the label names which. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      className="size-10 shrink-0 self-end p-0"
      onClick={onClick}
    >
      <XIcon aria-hidden />
    </Button>
  );
}

/** A refused send, in words with an icon. */
export function FormError({ error }: { error: ReportErrorKey | null }) {
  const t = useTranslations("report.errors");
  if (!error) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{t(error)}</span>
    </p>
  );
}
