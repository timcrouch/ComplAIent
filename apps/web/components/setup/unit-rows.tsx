"use client";

import { Button, Field, fieldA11y, Input, Select } from "@isms/ui";
import { CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Ref } from "react";
import type { CountryOption } from "../../lib/countries";
import type { RowError } from "./unit-errors";

export type SiteRow = { key: string; id?: string; name: string; countryCode: string };
export type DepartmentRow = { key: string; id?: string; name: string };
type AnyRow = SiteRow | DepartmentRow;

type UnitRowProps = {
  row: AnyRow;
  number: number;
  error: RowError | undefined;
  countries?: readonly CountryOption[];
  nameRef: (el: HTMLInputElement | null) => void;
  onChange: (patch: Partial<SiteRow>) => void;
  onRemove: () => void;
};

const isSite = (row: AnyRow): row is SiteRow => "countryCode" in row;

/** One repeatable row (a site with its country, or a department) in its own fieldset. */
export function UnitRow({
  row,
  number,
  error,
  countries,
  nameRef,
  onChange,
  onRemove,
}: UnitRowProps) {
  const t = useTranslations("setup");
  const site = isSite(row);
  const nameId = `${site ? "site" : "department"}-${row.key}-name`;
  const countryId = `site-${row.key}-country`;
  const nameError = error?.name ? t(`errors.${error.name}`) : undefined;
  const countryError = error?.countryCode ? t(`errors.${error.countryCode}`) : undefined;
  const label =
    row.name.trim() ||
    (site ? t("sites.unnamedSite", { number }) : t("sites.unnamedDepartment", { number }));

  return (
    <li>
      <fieldset className="rounded-md border border-[color-mix(in_oklab,var(--isms-text)_9%,transparent)] bg-[color-mix(in_oklab,var(--isms-surface),transparent_35%)] p-4">
        <legend className="sr-only">
          {site ? t("sites.siteLegend", { number }) : t("sites.departmentLegend", { number })}
        </legend>
        {error?.row ? (
          <p className="mb-3 flex items-start gap-2 rounded-sm bg-critical-soft px-3 py-2 text-[13px] font-medium text-critical">
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{t(`errors.${error.row}`)}</span>
          </p>
        ) : null}
        <div
          className={
            site
              ? "grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] sm:items-start"
              : "grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
          }
        >
          <Field
            id={nameId}
            label={site ? t("sites.siteName") : t("sites.departmentName")}
            error={nameError}
          >
            <Input
              id={nameId}
              ref={nameRef}
              value={row.name}
              onValueChange={(name) => {
                onChange({ name });
              }}
              {...fieldA11y(nameId, { hint: false, error: nameError })}
            />
          </Field>
          {site && countries ? (
            <Field id={countryId} label={t("sites.country")} error={countryError}>
              <Select
                id={countryId}
                value={row.countryCode}
                onChange={(e) => {
                  onChange({ countryCode: e.target.value });
                }}
                {...fieldA11y(countryId, { hint: false, error: countryError })}
              >
                <option value="" disabled>
                  {t("sites.countryChoose")}
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            aria-label={
              site
                ? t("sites.removeSite", { name: label })
                : t("sites.removeDepartment", { name: label })
            }
            onClick={onRemove}
            className="justify-self-start text-fg-muted hover:text-critical sm:mt-[26px]"
          >
            <Trash2Icon aria-hidden />
            {t("sites.remove")}
          </Button>
        </div>
      </fieldset>
    </li>
  );
}

export function AddButton({
  label,
  onClick,
  buttonRef,
}: {
  label: string;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      ref={buttonRef}
      onClick={onClick}
      className="self-start"
    >
      <PlusIcon aria-hidden />
      {label}
    </Button>
  );
}
