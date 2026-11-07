import type { TreatmentActionDto, TreatmentPlanDto } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { isOverdue, isoDate } from "./task-due.js";

type Db = Prisma.TransactionClient;

const PERSON = { select: { id: true, displayName: true } } as const;
const PLAN_LIMIT = 500;

export const TREATMENT_ACTION_SELECT = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  completedAt: true,
  completionNote: true,
  cancelledReason: true,
  createdAt: true,
  updatedAt: true,
  assignee: PERSON,
  completedBy: PERSON,
  control: { select: { code: true, title: true } },
} as const satisfies Prisma.TaskSelect;
export type TreatmentActionRow = Prisma.TaskGetPayload<{ select: typeof TREATMENT_ACTION_SELECT }>;

export function toTreatmentAction(t: TreatmentActionRow, today: string): TreatmentActionDto {
  const dueDate = t.dueDate === null ? null : isoDate(t.dueDate);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    assignee: t.assignee,
    dueDate,
    status: t.status,
    overdue: isOverdue(t.status, dueDate, today),
    control: t.control,
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: t.completedBy,
    completionNote: t.completionNote,
    cancelledReason: t.cancelledReason,
  };
}

const byDue = (a: TreatmentActionRow, b: TreatmentActionRow) => {
  const x = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const y = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return x - y || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
};
const newestFirst = (a: TreatmentActionRow, b: TreatmentActionRow) =>
  b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id);

/** A risk's treatment actions: open ones first by due date, then done and cancelled, newest first. */
export async function buildTreatmentPlan(
  db: Db,
  riskId: string,
  today: string,
): Promise<TreatmentPlanDto> {
  const rows = await db.task.findMany({
    where: { riskId, kind: "treatment_action" },
    select: TREATMENT_ACTION_SELECT,
    take: PLAN_LIMIT,
    orderBy: { createdAt: "desc" },
  });
  const open = rows.filter((r) => r.status === "open").sort(byDue);
  const closed = rows.filter((r) => r.status !== "open").sort(newestFirst);
  const actions = [...open, ...closed].map((r) => toTreatmentAction(r, today));
  return {
    actions,
    open: open.length,
    done: closed.filter((r) => r.status === "done").length,
    overdue: actions.filter((a) => a.overdue).length,
  };
}
