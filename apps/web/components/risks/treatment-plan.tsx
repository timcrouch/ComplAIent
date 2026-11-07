"use client";

import type { PersonRef, TreatmentActionDto } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import {
  CalendarIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ClockAlertIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { cancelTask, completeTask } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import { AddActionDialog } from "./add-action-dialog";
import { NoteDialog } from "./note-dialog";
import { planCall } from "./plan-call";
import { useRisk } from "./risk-context";

const STATUS: Record<TreatmentActionDto["status"], { icon: LucideIcon; tone: string }> = {
  open: { icon: CircleDotIcon, tone: "bg-info-soft text-info" },
  done: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
  cancelled: { icon: CircleSlashIcon, tone: "bg-surface text-fg-muted" },
};
const badge =
  "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap";

type Pending = { kind: "done" | "cancel"; action: TreatmentActionDto };

function ActionItem(props: {
  action: TreatmentActionDto;
  canAct: boolean;
  onAct: (kind: Pending["kind"]) => void;
}) {
  const { action, canAct, onAct } = props;
  const t = useTranslations("insights.plan");
  const { icon: Icon, tone } = STATUS[action.status];
  const open = action.status === "open";
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-surface-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(badge, tone)}>
          <Icon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
          <span>{t(`status.${action.status}`)}</span>
        </span>
        {open && action.overdue ? (
          <span className={cn(badge, "bg-attention-soft text-attention")}>
            <ClockAlertIcon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
            <span>{t("overdue")}</span>
          </span>
        ) : null}
      </div>
      <p className="text-[15px] font-semibold break-words text-fg">{action.title}</p>
      {action.description ? (
        <p className="text-[14px] whitespace-pre-line text-fg">{action.description}</p>
      ) : null}
      <p className="text-[13px] text-fg-muted">
        {t("assignee", { name: action.assignee.displayName })}
      </p>
      <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
        <CalendarIcon aria-hidden className="size-4" />
        {action.dueDate ? t("due", { date: formatDate(action.dueDate, "UTC") }) : t("noDue")}
      </p>
      {action.control ? (
        <p className="text-[13px] text-fg-muted">
          {t("control", { code: action.control.code, title: action.control.title })}
        </p>
      ) : null}
      {action.status === "done" && action.completionNote ? (
        <p className="text-[13px] whitespace-pre-line text-fg-muted">
          {action.completedBy ? t("doneBy", { name: action.completedBy.displayName }) : null}
          {action.completedBy ? " · " : null}
          {action.completionNote}
        </p>
      ) : null}
      {action.status === "cancelled" && action.cancelledReason ? (
        <p className="text-[13px] text-fg-muted">
          {t("cancelledWhy", { reason: action.cancelledReason })}
        </p>
      ) : null}
      {open && canAct ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onAct("done");
            }}
          >
            {t("markDone")} <span className="sr-only">{action.title}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onAct("cancel");
            }}
          >
            {t("cancel")} <span className="sr-only">{action.title}</span>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The risk's treatment actions: progress in words and a bar, each action with its owner, due
 * date and status, and (for those who may) adding, completing and cancelling. Every change
 * re-reads the risk so the plan and the "mark as treated" rule stay in step.
 */
export function TreatmentPlan({ people }: { people: readonly PersonRef[] | null }) {
  const t = useTranslations("insights.plan");
  const { risk, reload, announce } = useRisk();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const { treatmentPlan: plan, can } = risk;
  if (!can.planActions && plan.actions.length === 0) return null;

  const total = plan.open + plan.done;
  // Anyone who may plan, close or review can act on any action; the API refuses the rest.
  const canAct = can.planActions || can.close || can.reassess || can.confirmReview;
  const controls = risk.controls
    .filter((c) => c.status === "accepted")
    .map(({ controlId, code, title }) => ({ controlId, code, title }));

  async function refreshed(message: string) {
    await reload();
    announce(message);
  }

  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3 pt-4">
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-[15px] font-semibold text-fg outline-none"
      >
        {t("title")}
      </h3>
      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[14px] font-medium text-fg">
            {t("progress", { done: plan.done, total, overdue: plan.overdue })}
          </p>
          <div
            role="progressbar"
            aria-label={t("progressLabel")}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={plan.done}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-border"
          >
            <div
              className="h-full rounded-full bg-ok"
              style={{ width: `${String(Math.round((plan.done / total) * 100))}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-[14px] text-fg-muted">{t("empty")}</p>
      )}
      {plan.actions.length > 0 ? (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-2">
          {plan.actions.map((action) => (
            <ActionItem
              key={action.id}
              action={action}
              canAct={canAct}
              onAct={(kind) => {
                setPending({ kind, action });
              }}
            />
          ))}
        </ul>
      ) : null}
      {can.planActions && people && people.length > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden />
          {t("add")}
        </Button>
      ) : null}
      {can.planActions && (!people || people.length === 0) ? (
        <p className="text-[13px] text-fg-muted">{t("noPeople")}</p>
      ) : null}
      {adding && people ? (
        <AddActionDialog
          open
          onOpenChange={(next) => {
            if (!next) setAdding(false);
          }}
          riskId={risk.id}
          people={people}
          controls={controls}
          finalFocus={headingRef}
          onAdded={() => {
            setAdding(false);
            void refreshed(t("added"));
          }}
        />
      ) : null}
      {pending ? (
        <NoteDialog
          key={`${pending.kind}-${pending.action.id}`}
          open
          onOpenChange={(next) => {
            if (!next) setPending(null);
          }}
          title={t(pending.kind === "done" ? "doneDialog.title" : "cancelDialog.title")}
          description={t(
            pending.kind === "done" ? "doneDialog.description" : "cancelDialog.description",
          )}
          label={t(pending.kind === "done" ? "doneDialog.label" : "cancelDialog.label")}
          submitLabel={t(pending.kind === "done" ? "doneDialog.submit" : "cancelDialog.submit")}
          required={pending.kind === "cancel"}
          finalFocus={headingRef}
          submit={async (note) => {
            const result = await planCall(() =>
              pending.kind === "done"
                ? completeTask(pending.action.id, note)
                : cancelTask(pending.action.id, note),
            );
            if (!result.ok) return { ok: false, message: t(`errors.${result.error}`) };
            const message = t(pending.kind === "done" ? "completed" : "cancelled");
            setPending(null);
            void refreshed(message);
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );
}
