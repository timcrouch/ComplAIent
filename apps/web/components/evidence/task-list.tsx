"use client";

import type { MyTaskDto } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import {
  CalendarIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  ClockAlertIcon,
  ClipboardCheckIcon,
  UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { completeTask } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import { NoteDialog } from "../risks/note-dialog";
import { planCall } from "../risks/plan-call";
import { useTaskTitle } from "./task-title";
import { UploadDialog } from "./upload-dialog";

/** Each status in words with its own icon; colour is never the only signal. */
const STATUS: Record<MyTaskDto["status"], { icon: LucideIcon; tone: string }> = {
  open: { icon: CircleDotIcon, tone: "bg-info-soft text-info" },
  done: { icon: CircleCheckIcon, tone: "bg-ok-soft text-ok" },
  cancelled: { icon: CircleSlashIcon, tone: "bg-surface text-fg-muted" },
};

const badge =
  "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap";

type TaskItemProps = {
  task: MyTaskDto;
  showRiskDetails: boolean;
  onUpload: () => void;
  onComplete: () => void;
};

function TaskItem({ task, showRiskDetails, onUpload, onComplete }: TaskItemProps) {
  const t = useTranslations("tasks");
  const title = useTaskTitle()(task);
  const { icon: Icon, tone } = STATUS[task.status];
  const open = task.status === "open";
  const reference = t("risk", { reference: task.riskReference });
  return (
    <li
      data-task={task.id}
      className="flex flex-col gap-2 rounded-md border border-surface-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(badge, tone)}>
          <Icon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
          <span>{t(`status.${task.status}`)}</span>
        </span>
        {open && task.overdue ? (
          <span className={cn(badge, "bg-attention-soft text-attention")}>
            <ClockAlertIcon aria-hidden strokeWidth={2.25} className="size-3.5 shrink-0" />
            <span>{t("overdue")}</span>
          </span>
        ) : null}
        <span className={cn(badge, "bg-surface text-fg")}>
          <span>{t(`kind.${task.kind}`)}</span>
        </span>
        {showRiskDetails || task.kind === "periodic_review" ? (
          task.riskId ? (
            <Link
              href={`/risks/${task.riskId}`}
              className="text-[13px] font-semibold text-accent tabular-nums underline underline-offset-2"
            >
              {reference}
            </Link>
          ) : (
            <span className="text-[13px] font-semibold text-fg-muted tabular-nums">
              {reference}
            </span>
          )
        ) : null}
      </div>
      <h2
        tabIndex={-1}
        className="text-[16px] font-bold tracking-[-0.01em] break-words text-fg outline-none"
      >
        {title}
      </h2>
      <p className="text-[14px] leading-relaxed whitespace-pre-line text-fg">{task.description}</p>
      {task.control ? (
        <p className="text-[13px] text-fg-muted">
          {showRiskDetails
            ? t("control", { code: task.control.code, title: task.control.title })
            : t("controlTitle", { title: task.control.title })}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
        <CalendarIcon aria-hidden className="size-4" />
        {task.dueDate ? t("due", { date: formatDate(task.dueDate, "UTC") }) : t("noDue")}
      </p>
      {task.status === "done" && task.completionNote ? (
        <p className="text-[13px] whitespace-pre-line text-fg-muted">
          {t("doneNote", { note: task.completionNote })}
        </p>
      ) : null}
      {task.status === "done" && !task.completionNote && task.kind === "periodic_review" ? (
        <p className="text-[13px] text-fg-muted">{t("completedByApproval")}</p>
      ) : null}
      {open && task.kind === "evidence_request" ? (
        <Button type="button" variant="secondary" className="self-start" onClick={onUpload}>
          <UploadIcon aria-hidden />
          {t("upload")} <span className="sr-only">{title}</span>
        </Button>
      ) : null}
      {open && task.kind === "treatment_action" ? (
        <Button type="button" variant="secondary" className="self-start" onClick={onComplete}>
          <CircleCheckIcon aria-hidden />
          {t("markDone")} <span className="sr-only">{title}</span>
        </Button>
      ) : null}
      {open && task.kind === "periodic_review" && showRiskDetails ? (
        <Link
          href="/risks?filter=reviewDue"
          className="inline-flex items-center gap-1.5 self-start text-[14px] font-semibold text-accent underline underline-offset-2"
        >
          <ClipboardCheckIcon aria-hidden className="size-4" />
          {t("openRisk")}
        </Link>
      ) : null}
    </li>
  );
}

type TaskListProps = {
  initial: readonly MyTaskDto[];
  evidenceMaxBytes: number;
  /** Risk readers also see the risk's reference and the control's code; contributors don't. */
  showRiskDetails: boolean;
};

/**
 * The viewer's tasks: open ones first, then those done in the last 30 days. Each open
 * evidence request takes the file here; uploading it completes the task. A contributor sees
 * only the task's text, the control's title and the due date.
 */
export function TaskList({ initial, evidenceMaxBytes, showRiskDetails }: TaskListProps) {
  const t = useTranslations("tasks");
  const te = useTranslations("evidence.uploadDialog");
  const [tasks, setTasks] = useState(initial);
  const [uploading, setUploading] = useState<MyTaskDto | null>(null);
  const [completing, setCompleting] = useState<MyTaskDto | null>(null);
  const tp = useTranslations("insights.plan");
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const done = useRef<string | null>(null);

  /** After an upload the task's button is gone: focus its heading instead of the page body. */
  function finalFocus(): HTMLElement | true {
    const id = done.current;
    done.current = null;
    if (!id) return true;
    return (
      listRef.current?.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"] h2`) ?? true
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tasks.length === 0 ? (
        <p className="text-[15px] text-fg-muted">{t("empty")}</p>
      ) : (
        <ul ref={listRef} aria-label={t("listLabel")} className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              showRiskDetails={showRiskDetails}
              onUpload={() => {
                setUploading(task);
              }}
              onComplete={() => {
                setCompleting(task);
              }}
            />
          ))}
        </ul>
      )}
      <p data-testid="tasks-announcer" role="status" className="sr-only">
        {message}
      </p>
      {completing ? (
        <NoteDialog
          key={completing.id}
          open
          onOpenChange={(open) => {
            if (!open) setCompleting(null);
          }}
          title={t("doneDialogTitle", { title: completing.title })}
          description={t("doneDialogDescription")}
          label={t("noteLabel")}
          submitLabel={t("doneSubmit")}
          required={false}
          finalFocus={finalFocus}
          submit={async (note) => {
            const result = await planCall(() => completeTask(completing.id, note));
            if (!result.ok) return { ok: false, message: tp(`errors.${result.error}`) };
            done.current = completing.id;
            setTasks((all) =>
              all.map((x) =>
                x.id === completing.id ? { ...x, status: "done", overdue: false } : x,
              ),
            );
            setMessage(t("completed", { title: completing.title }));
            setCompleting(null);
            return { ok: true };
          }}
        />
      ) : null}
      {uploading ? (
        <UploadDialog
          key={uploading.id}
          open
          onOpenChange={(open) => {
            if (!open) setUploading(null);
          }}
          title={te("taskTitle", { title: uploading.title })}
          description={te("taskDescription")}
          url={`/tasks/${uploading.id}/evidence`}
          controls={null}
          maxBytes={evidenceMaxBytes}
          finalFocus={finalFocus}
          onUploaded={() => {
            done.current = uploading.id;
            setTasks((all) =>
              all.map((x) =>
                x.id === uploading.id ? { ...x, status: "done", overdue: false } : x,
              ),
            );
            setMessage(t("completed", { title: uploading.title }));
            setUploading(null);
          }}
        />
      ) : null}
    </div>
  );
}
