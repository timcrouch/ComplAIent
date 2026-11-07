"use client";

import { UnitsInput, type DepartmentDto, type SiteDto } from "@isms/contracts";
import { CircleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { saveUnits } from "../../lib/actions/setup";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import type { CountryOption } from "../../lib/countries";
import { FormFooter } from "./form-footer";
import { focusFirstInvalid, useSaveFlow } from "./save-flow";
import { nextStep, stepByKey } from "./steps";
import {
  detailIssues,
  placeIssues,
  unitsInUse,
  type UnitErrors,
  type UnitList,
} from "./unit-errors";
import { AddButton, UnitRow, type DepartmentRow, type SiteRow } from "./unit-rows";

type UnitsFormProps = {
  initialSites: readonly SiteDto[];
  initialDepartments: readonly DepartmentDto[];
  countries: readonly CountryOption[];
};

const noErrors = (): UnitErrors => ({ rows: {}, sitesRequired: false });
const stored = <T extends { id: string }>(unit: T) => ({ ...unit, key: unit.id });

/** Puts refused removals back where they were, so their message has a row to sit on. */
function restore<R extends { key: string }>(rows: R[], initial: readonly R[], ids: string[]): R[] {
  const next = [...rows];
  for (const id of ids) {
    if (next.some((r) => r.key === id)) continue;
    const at = initial.findIndex((r) => r.key === id);
    const original = initial[at];
    if (original) next.splice(Math.min(at, next.length), 0, original);
  }
  return next;
}

/**
 * The sites (at least one) and optional departments, saved together in one call: the API
 * applies both lists or neither. A unit still in use cannot be removed; it comes back with
 * a message on its row.
 */
export function UnitsForm({ initialSites, initialDepartments, countries }: UnitsFormProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const save = useSaveFlow();
  const formRef = useRef<HTMLFormElement>(null);
  const counter = useRef(0);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const addButtons = useRef<Partial<Record<UnitList, HTMLButtonElement | null>>>({});
  const focusNext = useRef<{ row: string } | { add: UnitList } | null>(null);

  const [initial] = useState(() => ({
    sites: initialSites.map(stored),
    departments: initialDepartments.map(stored),
  }));
  const [sites, setSites] = useState<SiteRow[]>(() =>
    initial.sites.length > 0 ? initial.sites : [{ key: "new-0", name: "", countryCode: "" }],
  );
  const [departments, setDepartments] = useState<DepartmentRow[]>(initial.departments);
  const [errors, setErrors] = useState<UnitErrors>(noErrors);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (!target) return;
    if ("row" in target) nameInputs.current.get(target.row)?.focus();
    else addButtons.current[target.add]?.focus();
  });

  const newKey = () => `new-${String(++counter.current)}`;
  const clearRow = (key: string) => {
    setErrors((e) => ({
      ...e,
      rows: Object.fromEntries(Object.entries(e.rows).filter(([k]) => k !== key)),
    }));
  };

  function addSite() {
    const key = newKey();
    setSites((rows) => [...rows, { key, name: "", countryCode: "" }]);
    setErrors((e) => ({ ...e, sitesRequired: false }));
    focusNext.current = { row: key };
  }
  function addDepartment() {
    const key = newKey();
    setDepartments((rows) => [...rows, { key, name: "" }]);
    focusNext.current = { row: key };
  }
  function remove(list: UnitList, key: string) {
    if (list === "sites") setSites((rows) => rows.filter((r) => r.key !== key));
    else setDepartments((rows) => rows.filter((r) => r.key !== key));
    clearRow(key);
    focusNext.current = { add: list };
  }

  function show(next: UnitErrors, placed: boolean) {
    setErrors(next);
    save.setFormError(placed ? "summary" : "notAccepted");
    // An empty site list has no invalid field to focus: start at "Add a site".
    if (next.sitesRequired && Object.keys(next.rows).length === 0) {
      requestAnimationFrame(() => addButtons.current.sites?.focus());
    } else focusFirstInvalid(formRef.current);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.busy) return;
    const keys = { sites: sites.map((r) => r.key), departments: departments.map((r) => r.key) };
    const parsed = UnitsInput.safeParse({
      sites: sites.map(({ id, name, countryCode }) => ({
        ...(id ? { id } : {}),
        name: name.trim(),
        countryCode,
      })),
      departments: departments.map(({ id, name }) => ({
        ...(id ? { id } : {}),
        name: name.trim(),
      })),
    });
    if (!parsed.success) {
      const next = noErrors();
      show(next, placeIssues(parsed.error.issues, keys, next));
      return;
    }
    setErrors(noErrors());
    const result = await save.run(() => saveUnits(parsed.data));
    if (result.ok) {
      requestStepHeadingFocus();
      router.push(nextStep("sites").path);
    } else if (result.kind === "invalid") {
      const next = noErrors();
      show(next, placeIssues(detailIssues(result.details), keys, next));
    } else if (result.kind === "conflict") {
      const inUse = unitsInUse(result.details);
      const next = noErrors();
      for (const id of inUse.sites) next.rows[id] = { row: "siteInUse" };
      for (const id of inUse.departments) next.rows[id] = { row: "departmentInUse" };
      setSites((rows) => restore(rows, initial.sites, inUse.sites));
      setDepartments((rows) => restore(rows, initial.departments, inUse.departments));
      setErrors(next);
      save.setFormError(
        inUse.sites.length + inUse.departments.length > 0 ? "summary" : "notAccepted",
      );
    }
  }

  const nameRef = (key: string) => (el: HTMLInputElement | null) => {
    if (el) nameInputs.current.set(key, el);
    else nameInputs.current.delete(key);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="flex flex-col gap-10"
    >
      <section aria-labelledby="sites-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="sites-title" className="text-lg font-bold tracking-[-0.01em] text-fg">
            {t("sites.sitesTitle")}
          </h2>
          <p className="text-[13px] leading-relaxed text-fg-muted">{t("sites.sitesHint")}</p>
        </div>
        {sites.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sites.map((row, i) => (
              <UnitRow
                key={row.key}
                row={row}
                number={i + 1}
                error={errors.rows[row.key]}
                countries={countries}
                nameRef={nameRef(row.key)}
                onChange={(patch) => {
                  setSites((rows) => rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
                }}
                onRemove={() => {
                  remove("sites", row.key);
                }}
              />
            ))}
          </ul>
        ) : null}
        {errors.sitesRequired ? (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-critical">
            <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
            {t("errors.sitesRequired")}
          </p>
        ) : null}
        <AddButton
          label={t("sites.addSite")}
          onClick={addSite}
          buttonRef={(el) => {
            addButtons.current.sites = el;
          }}
        />
      </section>

      <section aria-labelledby="departments-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="departments-title" className="text-lg font-bold tracking-[-0.01em] text-fg">
            {t("sites.departmentsTitle")}
          </h2>
          <p className="text-[13px] leading-relaxed text-fg-muted">{t("sites.departmentsHint")}</p>
        </div>
        {departments.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {departments.map((row, i) => (
              <UnitRow
                key={row.key}
                row={row}
                number={i + 1}
                error={errors.rows[row.key]}
                nameRef={nameRef(row.key)}
                onChange={(patch) => {
                  setDepartments((rows) =>
                    rows.map((r) => (r.key === row.key ? { ...r, name: patch.name ?? r.name } : r)),
                  );
                }}
                onRemove={() => {
                  remove("departments", row.key);
                }}
              />
            ))}
          </ul>
        ) : null}
        <AddButton
          label={t("sites.addDepartment")}
          onClick={addDepartment}
          buttonRef={(el) => {
            addButtons.current.departments = el;
          }}
        />
      </section>

      <FormFooter
        status={save.status}
        formError={save.formError}
        backHref={stepByKey("organisation").path}
      />
    </form>
  );
}
