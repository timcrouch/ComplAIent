import type { MyTaskDto } from "@isms/contracts";
import { useTranslations } from "next-intl";

type TaskLabel = Pick<MyTaskDto, "kind" | "title" | "riskReference" | "riskTitle">;

/**
 * A task's heading: a periodic review is named from its risk ("Review R-0001: Lost laptop"),
 * in the viewer's language; every other task by its own title. Used by the task list and home.
 */
export function useTaskTitle(): (task: TaskLabel) => string {
  const t = useTranslations("tasks");
  return (task) =>
    task.kind === "periodic_review"
      ? t("reviewTitle", { reference: task.riskReference, title: task.riskTitle ?? "" })
      : task.title;
}
