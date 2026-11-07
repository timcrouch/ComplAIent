"use client";

import type { WorkspaceTaskDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { ClockAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";
import { useTaskTitle } from "../evidence/task-title";
import { glass } from "./styles";
import { HomeSection } from "./home-section";

/** The viewer's open tasks (at most five, soonest due first); overdue in words and an icon. */
export function MyTasks({ tasks }: { tasks: readonly WorkspaceTaskDto[] }) {
  const t = useTranslations("home.tasks");
  const title = useTaskTitle();
  return (
    <HomeSection
      id="home-tasks-title"
      title={t("title")}
      more={{ href: "/tasks", label: t("all") }}
    >
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={cn(
              glass,
              "flex flex-col gap-2 rounded-md p-4 sm:flex-row sm:items-center sm:gap-4",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-[15px] font-semibold break-words text-fg">{title(task)}</p>
              <p className="text-[13px] text-fg-muted">
                {/* A calendar date: shown as stored, not shifted into the viewer's zone. */}
                {task.dueDate ? t("due", { date: formatDate(task.dueDate, "UTC") }) : t("noDue")}
              </p>
            </div>
            {task.overdue ? (
              <span className="inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full bg-attention-soft pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap text-attention">
                <ClockAlertIcon aria-hidden strokeWidth={2.25} className="size-4 shrink-0" />
                <span>{t("overdue")}</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}
