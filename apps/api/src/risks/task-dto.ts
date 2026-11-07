import type { MyTaskDto } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { formatRiskReference } from "@isms/domain";
import type { PolicyService } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { riskVisibilityWhere } from "./risk-visibility.js";
import { isOverdue, isoDate } from "./task-due.js";

type Db = Prisma.TransactionClient;

export const TASK_SELECT = {
  id: true,
  kind: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  createdAt: true,
  completedAt: true,
  completionNote: true,
  riskId: true,
  control: { select: { code: true, title: true } },
  risk: { select: { reference: true, title: true } },
} as const satisfies Prisma.TaskSelect;
export type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

/** Which of these risks the actor may open: risks.read somewhere, and the risk visible to them. */
export async function visibleRiskIds(
  db: Db,
  policy: PolicyService,
  actor: Actor,
  riskIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (riskIds.length === 0 || !policy.canAtAnyScope(actor, "risks.read")) return new Set();
  const rows = await db.risk.findMany({
    where: { AND: [{ id: { in: [...new Set(riskIds)] } }, riskVisibilityWhere(actor)] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * The risk fields a task shows: the risk's title for actions and reviews (never for evidence
 * requests), and its id only when the reader may open it. The label of a periodic review is
 * built by the client from these, so no English is made here.
 */
export function taskRiskFields(
  kind: TaskRow["kind"],
  riskId: string,
  risk: { reference: number; title: string },
  visible: ReadonlySet<string>,
): { riskReference: string; riskTitle: string | null; riskId: string | null } {
  return {
    riskReference: formatRiskReference(risk.reference),
    riskTitle: kind === "evidence_request" ? null : risk.title,
    riskId: visible.has(riskId) ? riskId : null,
  };
}

/** A task as its assignee sees it: the risk's reference and title, the record only if visible. */
export function toTask(t: TaskRow, today: string, visible: ReadonlySet<string>): MyTaskDto {
  const dueDate = t.dueDate === null ? null : isoDate(t.dueDate);
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    dueDate,
    status: t.status,
    overdue: isOverdue(t.status, dueDate, today),
    control: t.control,
    ...taskRiskFields(t.kind, t.riskId, t.risk, visible),
    completionNote: t.completionNote,
  };
}
