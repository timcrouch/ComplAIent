"use client";

import {
  AiActRoleSchema,
  AiSystemInput,
  AiSystemStatusSchema,
  conflictReasons,
  type AiSystemDetailDto,
  type PersonRef,
} from "@isms/contracts";
import { Button, buttonVariants, Field, fieldA11y, Input, Select, Textarea } from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { createAiSystem, updateAiSystem } from "../../lib/actions/ai-act";
import { settle, signInAgain } from "../risks/risk-call";
import { choiceInput } from "../setup/styles";

const FIELDS = [
  "name",
  "description",
  "intendedPurpose",
  "role",
  "status",
  "supplier",
  "model",
  "ownerId",
  "departmentId",
] as const;
type FieldName = (typeof FIELDS)[number];
type FieldError = FieldName | "duplicateName";
type Errors = Partial<Record<FieldName, FieldError>>;
type FormError = "summary" | "forbidden" | "unavailable";

const isField = (path: string): path is FieldName => (FIELDS as readonly string[]).includes(path);

function errorsFor(paths: readonly string[]): Errors {
  const errors: Errors = {};
  for (const path of paths) {
    const head = path.split(".")[0] ?? "";
    if (isField(head)) errors[head] = head;
  }
  return errors;
}

type Props = {
  /** The system being edited, or null to add one. */
  initial: AiSystemDetailDto | null;
  /** Who can be chosen as owner; the API checks the choice. */
  people: readonly PersonRef[];
  departments: readonly { id: string; name: string }[];
  /** The owner a new system starts with (the viewer). */
  defaultOwnerId: string;
};

const blankToNull = (value: string) => (value.trim() === "" ? null : value.trim());

/** The AI system's profile, for adding a system or editing one. */
export function SystemForm({ initial, people, departments, defaultOwnerId }: Props) {
  const t = useTranslations("aiAct");
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    intendedPurpose: initial?.intendedPurpose ?? "",
    role: initial?.role ?? "deployer",
    status: initial?.status ?? "in_use",
    supplier: initial?.supplier ?? "",
    model: initial?.model ?? "",
    usesGeneralPurposeModel: initial?.usesGeneralPurposeModel ?? false,
    ownerId: initial?.owner.id ?? defaultOwnerId,
    departmentId: initial?.department?.id ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const set =
    <K extends keyof typeof values>(key: K) =>
    (value: (typeof values)[K]) => {
      setValues((v) => ({ ...v, [key]: value }));
    };

  function showErrors(next: Errors, fallback: FormError = "summary") {
    setErrors(next);
    setFormError(Object.keys(next).length > 0 ? "summary" : fallback);
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = AiSystemInput.safeParse({
      name: values.name.trim(),
      description: values.description.trim(),
      intendedPurpose: values.intendedPurpose.trim(),
      role: values.role,
      status: values.status,
      supplier: blankToNull(values.supplier),
      model: blankToNull(values.model),
      usesGeneralPurposeModel: values.usesGeneralPurposeModel,
      ownerId: values.ownerId || undefined,
      departmentId: values.departmentId || null,
    });
    if (!parsed.success) {
      showErrors(errorsFor(parsed.error.issues.map((i) => i.path.map(String).join("."))));
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    const result = await settle(() =>
      initial ? updateAiSystem(initial.id, parsed.data) : createAiSystem(parsed.data),
    );
    if (result.ok) {
      // A new system goes straight on to its questionnaire; an edit back to the system.
      router.push(
        initial ? `/ai-act/systems/${initial.id}` : `/ai-act/systems/${result.data.id}/classify`,
      );
      return;
    }
    setSaving(false);
    if (signInAgain(result)) return;
    if (result.kind === "invalid") showErrors(errorsFor(result.details.map((d) => d.path)));
    else if (
      result.kind === "conflict" &&
      conflictReasons(result.details).some((c) => c.reason === "duplicateAiSystemName")
    ) {
      showErrors({ name: "duplicateName" });
    } else setFormError(result.kind === "forbidden" ? "forbidden" : "unavailable");
  }

  const field = (name: FieldName, hint: boolean) => {
    const error = errors[name];
    const fieldId = `${id}-${name}`;
    return {
      id: fieldId,
      error: error ? t(`form.errors.${error}`) : undefined,
      a11y: fieldA11y(fieldId, { hint, error }),
    };
  };
  const f = {
    name: field("name", true),
    description: field("description", true),
    intendedPurpose: field("intendedPurpose", true),
    role: field("role", true),
    status: field("status", false),
    supplier: field("supplier", true),
    model: field("model", true),
    ownerId: field("ownerId", true),
    departmentId: field("departmentId", false),
  };
  // The current owner stays choosable even when the list of people can't be read.
  const owners =
    initial && !people.some((p) => p.id === initial.owner.id) ? [initial.owner, ...people] : people;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-[640px] flex-col gap-6"
    >
      <Field id={f.name.id} label={t("form.name")} hint={t("form.nameHint")} error={f.name.error}>
        <Input
          id={f.name.id}
          value={values.name}
          maxLength={200}
          onValueChange={set("name")}
          {...f.name.a11y}
        />
      </Field>
      <Field
        id={f.intendedPurpose.id}
        label={t("form.intendedPurpose")}
        hint={t("form.intendedPurposeHint")}
        error={f.intendedPurpose.error}
      >
        <Textarea
          id={f.intendedPurpose.id}
          value={values.intendedPurpose}
          onChange={(e) => {
            set("intendedPurpose")(e.target.value);
          }}
          {...f.intendedPurpose.a11y}
        />
      </Field>
      <Field
        id={f.description.id}
        label={t("form.description")}
        hint={t("form.descriptionHint")}
        error={f.description.error}
      >
        <Textarea
          id={f.description.id}
          rows={3}
          value={values.description}
          onChange={(e) => {
            set("description")(e.target.value);
          }}
          {...f.description.a11y}
        />
      </Field>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field id={f.role.id} label={t("form.role")} hint={t("form.roleHint")} error={f.role.error}>
          <Select
            id={f.role.id}
            value={values.role}
            onChange={(e) => {
              set("role")(AiActRoleSchema.parse(e.target.value));
            }}
            {...f.role.a11y}
          >
            {AiActRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={f.status.id} label={t("form.status")} error={f.status.error}>
          <Select
            id={f.status.id}
            value={values.status}
            onChange={(e) => {
              set("status")(AiSystemStatusSchema.parse(e.target.value));
            }}
            {...f.status.a11y}
          >
            {AiSystemStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={f.supplier.id}
          label={t("form.supplier")}
          hint={t("form.supplierHint")}
          error={f.supplier.error}
        >
          <Input
            id={f.supplier.id}
            value={values.supplier}
            maxLength={200}
            onValueChange={set("supplier")}
            {...f.supplier.a11y}
          />
        </Field>
        <Field
          id={f.model.id}
          label={t("form.model")}
          hint={t("form.modelHint")}
          error={f.model.error}
        >
          <Input
            id={f.model.id}
            value={values.model}
            maxLength={200}
            onValueChange={set("model")}
            {...f.model.a11y}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-fg">
        <input
          type="checkbox"
          checked={values.usesGeneralPurposeModel}
          aria-describedby={`${id}-gpai-hint`}
          onChange={(e) => {
            set("usesGeneralPurposeModel")(e.target.checked);
          }}
          className={choiceInput}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t("form.usesGpai")}</span>
          <span id={`${id}-gpai-hint`} className="text-[13px] text-fg-muted">
            {t("form.usesGpaiHint")}
          </span>
        </span>
      </label>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          id={f.ownerId.id}
          label={t("form.owner")}
          hint={t("form.ownerHint")}
          error={f.ownerId.error}
        >
          <Select
            id={f.ownerId.id}
            value={values.ownerId}
            onChange={(e) => {
              set("ownerId")(e.target.value);
            }}
            {...f.ownerId.a11y}
          >
            <option value="" disabled>
              {t("form.ownerChoose")}
            </option>
            {owners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={f.departmentId.id} label={t("form.department")} error={f.departmentId.error}>
          <Select
            id={f.departmentId.id}
            value={values.departmentId}
            onChange={(e) => {
              set("departmentId")(e.target.value);
            }}
            {...f.departmentId.a11y}
          >
            <option value="">{t("form.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-col gap-3 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-6">
        {formError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{t(`form.errors.${formError}`)}</span>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link
            href={initial ? `/ai-act/systems/${initial.id}` : "/ai-act"}
            className={buttonVariants({ variant: "ghost" })}
          >
            {t("form.cancel")}
          </Link>
          <Button type="submit" disabled={saving} focusableWhenDisabled>
            {saving ? t("form.saving") : initial ? t("form.save") : t("form.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
