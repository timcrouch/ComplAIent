import { evidenceRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { TaskList } from "../../../components/evidence/task-list";
import { Entrance } from "../../../components/motion/entrance";
import { requireViewer } from "../../../lib/current-viewer";
import { env } from "../../../lib/env";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/tasks";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = { title: tm("tasks.pageTitle", { app: tm("app.name") }) };

/** The viewer's tasks: evidence requests to answer with a file, and those done recently. */
export default async function TasksPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  const tasks = await callApi(evidenceRoutes.myTasks, {}, { returnTo: PATH });
  if (!tasks.ok) return failureScreen(tasks, PATH);
  const t = await getTranslations("tasks");

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <TaskList
          initial={tasks.data.items}
          evidenceMaxBytes={env().EVIDENCE_MAX_BYTES}
          showRiskDetails={viewer.me.permissions.includes("risks.read")}
        />
      </Entrance>
    </div>
  );
}
