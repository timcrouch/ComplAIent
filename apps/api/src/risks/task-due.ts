import type { Prisma } from "@isms/database";

/** A UTC calendar day as `YYYY-MM-DD`, the form task due dates cross the API in. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** An open task is overdue once its due day is before today (UTC). */
export function isOverdue(status: string, dueDate: string | null, today: string): boolean {
  return status === "open" && dueDate !== null && dueDate < today;
}

/** The same rule as `isOverdue`, as a Prisma condition, for counts. */
export function overdueTaskWhere(today: string): Prisma.TaskWhereInput {
  return { status: "open", dueDate: { lt: new Date(today) } };
}
