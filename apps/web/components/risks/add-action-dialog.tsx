"use client";

import type { PersonRef } from "@isms/contracts";
import {
  Button,
  Dialog,
  type DialogContentProps,
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
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { addTreatmentAction } from "../../lib/actions/risks";
import { ProblemText } from "./notices";
import { planCall, type PlanErrorKey } from "./plan-call";

type Required = "actionTitle" | "assignee" | "dueDate";
const ERROR_OF = {
  actionTitle: "titleRequired",
  assignee: "assigneeRequired",
  dueDate: "dueRequired",
} as const;

export type ControlOption = { controlId: string; code: string; title: string };

type AddActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  riskId: string;
  people: readonly PersonRef[];
  controls: readonly ControlOption[];
  onAdded: () => void;
  finalFocus?: DialogContentProps["finalFocus"];
};

/** Add one treatment action: what, who, by when, and optionally which accepted control. */
export function AddActionDialog(props: AddActionDialogProps) {
  const { open, onOpenChange, riskId, people, controls, onAdded } = props;
  const t = useTranslations("insights.plan");
  const id = useId();
  const refs = {
    actionTitle: useRef<HTMLInputElement>(null),
    assignee: useRef<HTMLSelectElement>(null),
    dueDate: useRef<HTMLInputElement>(null),
  };
  const [missing, setMissing] = useState<ReadonlySet<Required>>(new Set());
  const [error, setError] = useState<PlanErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = form.get(name);
      return typeof entry === "string" ? entry.trim() : "";
    };
    const empty = (Object.keys(refs) as Required[]).filter((k) => value(k) === "");
    setMissing(new Set(empty));
    const first = empty[0];
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setBusy(true);
    const result = await planCall(() =>
      addTreatmentAction(riskId, {
        title: value("actionTitle"),
        description: value("details"),
        assigneeId: value("assignee"),
        dueDate: value("dueDate"),
        controlId: value("control") || null,
      }),
    );
    setBusy(false);
    if (result.ok) onAdded();
    else {
      setError(result.error);
      if (result.error === "dueDatePast") refs.dueDate.current?.focus();
    }
  }

  const field = (name: Required, refused?: string) => {
    const fieldId = `${id}-${name}`;
    const message = missing.has(name) ? t(`form.${ERROR_OF[name]}`) : refused;
    return { fieldId, message, a11y: fieldA11y(fieldId, { hint: false, error: message }) };
  };
  const clear = (name: Required) => () => {
    if (missing.has(name)) setMissing(new Set([...missing].filter((m) => m !== name)));
  };
  const title = field("actionTitle");
  const assignee = field("assignee");
  // A past due date is refused by the API: shown on the field, not as a dialog-wide problem.
  const due = field("dueDate", error === "dueDatePast" ? t("errors.dueDatePast") : undefined);
  const problem = error === "dueDatePast" ? null : error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("form.cancel")}
        initialFocus={refs.actionTitle}
        {...(props.finalFocus === undefined ? {} : { finalFocus: props.finalFocus })}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("form.title")}</DialogTitle>
          <DialogDescription>{t("form.description")}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <Field id={title.fieldId} label={t("form.actionTitle")} error={title.message}>
            <Input
              id={title.fieldId}
              ref={refs.actionTitle}
              name="actionTitle"
              maxLength={200}
              onChange={clear("actionTitle")}
              {...title.a11y}
            />
          </Field>
          <Field id={`${id}-details`} label={t("form.details")}>
            <Textarea
              id={`${id}-details`}
              name="details"
              maxLength={2000}
              {...fieldA11y(`${id}-details`, { hint: false, error: false })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={assignee.fieldId} label={t("form.assignee")} error={assignee.message}>
              <Select
                id={assignee.fieldId}
                ref={refs.assignee}
                name="assignee"
                defaultValue=""
                onChange={clear("assignee")}
                {...assignee.a11y}
              >
                <option value="" disabled>
                  {t("form.chooseAssignee")}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={due.fieldId} label={t("form.dueDate")} error={due.message}>
              <Input
                id={due.fieldId}
                ref={refs.dueDate}
                type="date"
                name="dueDate"
                onChange={() => {
                  clear("dueDate")();
                  if (error === "dueDatePast") setError(null);
                }}
                {...due.a11y}
              />
            </Field>
          </div>
          {controls.length > 0 ? (
            <Field id={`${id}-control`} label={t("form.control")}>
              <Select
                id={`${id}-control`}
                name="control"
                defaultValue=""
                {...fieldA11y(`${id}-control`, { hint: false, error: false })}
              >
                <option value="">{t("form.noControl")}</option>
                {controls.map((c) => (
                  <option key={c.controlId} value={c.controlId}>
                    {`${c.code} ${c.title}`}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div role="status">
            {problem ? <ProblemText>{t(`errors.${problem}`)}</ProblemText> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t("form.cancel")}
            </DialogClose>
            <Button type="submit" aria-disabled={busy || undefined}>
              <PlusIcon aria-hidden />
              {busy ? t("form.saving") : t("form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
