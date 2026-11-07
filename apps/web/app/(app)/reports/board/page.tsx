import { organisationRoutes, reportRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../../components/motion/entrance";
import { BoardPack } from "../../../../components/reports/board-pack";
import { periodName } from "../../../../components/reports/period-name";
import { noticeClass } from "../../../../components/reports/styles";
import { StatusScreen } from "../../../../components/status/status-screen";
import { requireViewer } from "../../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const PATH = "/reports/board";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("reports.board.pageTitle", { app: tm("app.name") }),
};

type BoardPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The board pack for a period (the default is the API's latest), with the narrative and the PDF.
 * A period the API no longer offers falls back to the default, with a notice.
 */
export default async function BoardPage({ searchParams }: BoardPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("reports.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const { period } = await searchParams;
  const key =
    typeof period === "string" && period.length > 0 && period.length <= 20 ? period : undefined;
  const [asked, organisation] = await Promise.all([
    callApi(reportRoutes.board, { query: key ? { period: key } : {} }, { returnTo: PATH }),
    callApi(organisationRoutes.get, {}, { returnTo: PATH }),
  ]);
  // An unknown or expired period (an old link) shows the default period with a notice.
  const gone = !asked.ok && asked.kind === "invalid" && key !== undefined;
  const pack = gone ? await callApi(reportRoutes.board, { query: {} }, { returnTo: PATH }) : asked;
  if (!pack.ok) return failureScreen(pack, PATH);
  if (!organisation.ok) return failureScreen(organisation, PATH);

  const t = await getTranslations("reports.board");
  const scale = organisation.data.riskScale ?? organisation.data.defaultRiskScale;
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <a href="/reports" className="text-[13px] font-semibold text-accent">
          {t("back")}
        </a>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
        {gone ? (
          <p role="status" className={noticeClass}>
            {t("periodGone", { label: periodName(pack.data.period, t("last30Days")) })}
          </p>
        ) : null}
      </Entrance>
      <Entrance order={1}>
        <BoardPack pack={pack.data} scale={scale} timeZone={timeZone} />
      </Entrance>
    </div>
  );
}
