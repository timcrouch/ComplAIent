"use client";

import { conflictReasons, type PersonRef } from "@isms/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  fieldA11y,
  Input,
  Select,
  Textarea,
} from "@isms/ui";
import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { requestEvidence } from "../../lib/actions/risks";
import { ProblemText } from "../risks/notices";
import { settle, signInAgain, type Failure } from "../risks/risk-call";
import type { ControlChoice } from "./upload-dialog";
import type { EvidenceErrorKey } from "./upload-errors";

type Required = "person" | "control" | "taskTitle" | "description";
const ERROR_OF: Record<Required, EvidenceErrorKey> = {
  person: "personRequired",
  control: "controlRequired",
  taskTitle: "titleRequired",
  description: "descriptionRequired",
};

function requestErrorKey(result: Failure): EvidenceErrorKey {
  switch (result.kind) {
    case "invalid":
      return result.details.some((d) => d.path.endsWith("assigneeId"))
        ? "personRequired"
        : "invalid";
    case "conflict":
      return conflictReasons(result.details)[0]?.reason === "controlNotAccepted"
        ? "controlNotAccepted"
        : "invalid";
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "notFound";
    default:
      return "unavailable";
  }
}

type RequestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  riskId: string;
  people: readonly PersonRef[];
  controls: readonly ControlChoice[];
  onSent: (person: PersonRef) => void;
};

/** Ask a person for evidence of one accepted control: it becomes a task in their list. */
export function RequestDialog(props: RequestDialogProps) {
  const { open, onOpenChange, riskId, people, controls, onSent } = props;
  const t = useTranslations("evidence");
  const id = useId();
  const refs = {
    person: useRef<HTMLSelectElement>(null),
    control: useRef<HTMLSelectElement>(null),
    taskTitle: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };
  const [missing, setMissing] = useState<ReadonlySet<Required>>(new Set());
  const [error, setError] = useState<EvidenceErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = form.get(name);
      return typeof entry === "string" ? entry : "";
    };
    const values = {
      person: value("person"),
      control: value("control"),
      taskTitle: value("taskTitle"),
      description: value("description"),
    };
    const empty = (Object.keys(values) as Required[]).filter((k) => values[k].trim() === "");
    setMissing(new Set(empty));
    const first = empty[0];
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setBusy(true);
    const result = await settle(() =>
      requestEvidence(riskId, {
        assigneeId: values.person,
        controlId: values.control,
        title: values.taskTitle,
        description: values.description,
        dueDate: value("dueDate") || null,
      }),
    );
    setBusy(false);
    if (result.ok) {
      const person = people.find((p) => p.id === values.person);
      if (person) onSent(person);
      return;
    }
    if (!signInAgain(result)) setError(requestErrorKey(result));
  }

  const field = (name: Required) => {
    const fieldId = `${id}-${name}`;
    const message = missing.has(name) ? t(`errors.${ERROR_OF[name]}`) : undefined;
    return { fieldId, message, a11y: fieldA11y(fieldId, { hint: false, error: message }) };
  };
  const person = field("person");
  const control = field("control");
  const taskTitle = field("taskTitle");
  const description = field("description");
  const clear = (name: Required) => () => {
    if (missing.has(name)) setMissing(new Set([...missing].filter((m) => m !== name)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("requestDialog.cancel")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("requestDialog.title")}</DialogTitle>
          <DialogDescription>{t("requestDialog.description")}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={person.fieldId} label={t("requestDialog.person")} error={person.message}>
              <Select
                id={person.fieldId}
                ref={refs.person}
                name="person"
                defaultValue=""
                onChange={clear("person")}
                {...person.a11y}
              >
                <option value="" disabled>
                  {t("requestDialog.choosePerson")}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={control.fieldId} label={t("requestDialog.control")} error={control.message}>
              <Select
                id={control.fieldId}
                ref={refs.control}
                name="control"
                defaultValue=""
                onChange={clear("control")}
                {...control.a11y}
              >
                <option value="" disabled>
                  {t("requestDialog.chooseControl")}
                </option>
                {controls.map((c) => (
                  <option key={c.controlId} value={c.controlId}>
                    {`${c.code} ${c.title}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            id={taskTitle.fieldId}
            label={t("requestDialog.taskTitle")}
            error={taskTitle.message}
          >
            <Input
              id={taskTitle.fieldId}
              ref={refs.taskTitle}
              name="taskTitle"
              maxLength={120}
              onChange={clear("taskTitle")}
              {...taskTitle.a11y}
            />
          </Field>
          <Field
            id={description.fieldId}
            label={t("requestDialog.details")}
            error={description.message}
          >
            <Textarea
              id={description.fieldId}
              ref={refs.description}
              name="description"
              maxLength={2000}
              onChange={clear("description")}
              {...description.a11y}
            />
          </Field>
          <Field
            id={`${id}-due`}
            label={t("requestDialog.dueDate")}
            hint={t("requestDialog.dueHint")}
          >
            <Input
              id={`${id}-due`}
              type="date"
              name="dueDate"
              {...fieldA11y(`${id}-due`, { hint: true, error: false })}
            />
          </Field>
          <div role="status">
            {error ? <ProblemText>{t(`errors.${error}`, { size: "" })}</ProblemText> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("requestDialog.cancel")}
            </DialogClose>
            <Button type="submit" aria-disabled={busy || undefined}>
              <SendIcon aria-hidden />
              {busy ? t("requestDialog.sending") : t("requestDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
