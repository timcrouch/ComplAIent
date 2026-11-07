"use client";

import { ProfileInput, type OrganisationProfileDto } from "@isms/contracts";
import { Field, fieldA11y, Input, Textarea } from "@isms/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type SubmitEvent } from "react";
import { saveProfile } from "../../lib/actions/setup";
import { requestStepHeadingFocus } from "../../lib/step-focus";
import { FormFooter } from "./form-footer";
import { focusFirstInvalid, useSaveFlow, type SetupErrorKey } from "./save-flow";
import { nextStep } from "./steps";

type ProfileField = "name" | "description" | "approximateHeadcount";
type Errors = Partial<Record<ProfileField, SetupErrorKey>>;

/** Each field's message; the API's own text is never shown. */
const FIELD_ERRORS: Record<ProfileField, SetupErrorKey> = {
  name: "name",
  description: "description",
  approximateHeadcount: "headcount",
};

const isField = (path: string): path is ProfileField => path in FIELD_ERRORS;

function errorsFor(paths: readonly string[]): Errors {
  const errors: Errors = {};
  for (const path of paths) if (isField(path)) errors[path] = FIELD_ERRORS[path];
  return errors;
}

/** "120" → 120; anything that is not a whole number is left for the schema to refuse. */
const headcountValue = (raw: string): unknown => (/^\d+$/.test(raw) ? Number(raw) : undefined);

export function ProfileForm({ initial }: { initial: OrganisationProfileDto | null }) {
  const t = useTranslations("setup");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const save = useSaveFlow();
  const [errors, setErrors] = useState<Errors>({});
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    headcount: initial?.approximateHeadcount?.toString() ?? "",
  });

  const set = (field: keyof typeof values) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
  };

  function showErrors(next: Errors): void {
    setErrors(next);
    save.setFormError(Object.keys(next).length > 0 ? "summary" : "notAccepted");
    focusFirstInvalid(formRef.current);
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.busy) return;
    const parsed = ProfileInput.safeParse({
      name: values.name.trim(),
      description: values.description.trim(),
      approximateHeadcount: headcountValue(values.headcount.trim()),
    });
    if (!parsed.success) {
      showErrors(errorsFor(parsed.error.issues.map((i) => i.path.map(String).join("."))));
      return;
    }
    setErrors({});
    const result = await save.run(() => saveProfile(parsed.data));
    if (result.ok) {
      requestStepHeadingFocus();
      router.push(nextStep("organisation").path);
    } else if (result.kind === "invalid") showErrors(errorsFor(result.details.map((d) => d.path)));
    else if (result.kind === "conflict") save.setFormError("notAccepted");
  }

  const field = (id: string, key: ProfileField, hint: boolean) => {
    const error = errors[key];
    return {
      id,
      error: error ? t(`errors.${error}`) : undefined,
      a11y: fieldA11y(id, { hint, error }),
    };
  };
  const name = field("org-name", "name", true);
  const description = field("org-description", "description", true);
  const headcount = field("org-headcount", "approximateHeadcount", true);

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col">
      <div className="flex max-w-[560px] flex-col gap-6">
        <Field
          id={name.id}
          label={t("organisation.name")}
          hint={t("organisation.nameHint")}
          error={name.error}
        >
          <Input
            id={name.id}
            autoComplete="organization"
            value={values.name}
            onValueChange={set("name")}
            {...name.a11y}
          />
        </Field>
        <Field
          id={description.id}
          label={t("organisation.description")}
          hint={t("organisation.descriptionHint")}
          error={description.error}
        >
          <Textarea
            id={description.id}
            value={values.description}
            onChange={(e) => {
              set("description")(e.target.value);
            }}
            {...description.a11y}
          />
        </Field>
        <Field
          id={headcount.id}
          label={t("organisation.headcount")}
          hint={t("organisation.headcountHint")}
          error={headcount.error}
        >
          <Input
            id={headcount.id}
            inputMode="numeric"
            className="sm:max-w-40"
            value={values.headcount}
            onValueChange={set("headcount")}
            {...headcount.a11y}
          />
        </Field>
      </div>
      <FormFooter status={save.status} formError={save.formError} />
    </form>
  );
}
