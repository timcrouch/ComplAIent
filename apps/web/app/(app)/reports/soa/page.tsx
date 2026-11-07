import { reportRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../../components/motion/entrance";
import { SoaToolbar } from "../../../../components/reports/soa-toolbar";
import { SoaTable } from "../../../../components/reports/soa-table";
import { noticeClass } from "../../../../components/reports/styles";
import { StatusScreen } from "../../../../components/status/status-screen";
import { cookies } from "next/headers";
import { requireViewer } from "../../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const PATH = "/reports/soa";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("reports.soaPage.pageTitle", { app: tm("app.name") }),
};

type SoaPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The Statement of Applicability of a confirmed framework, with inline decisions for managers. */
export default async function SoaPage({ searchParams }: SoaPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("reports.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const { framework, undecided } = await searchParams;
  const onlyUndecided = undecided === "1";
  const key = typeof framework === "string" && framework.length <= 100 ? framework : undefined;
  const asked = await callApi(
    reportRoutes.soa,
    { query: key ? { framework: key } : {} },
    { returnTo: PATH },
  );
  // A framework that is not (or no longer) confirmed shows the default one, with a notice.
  const gone = !asked.ok && asked.kind === "not-found" && key !== undefined;
  const result = gone ? await callApi(reportRoutes.soa, { query: {} }, { returnTo: PATH }) : asked;
  if (!result.ok) return failureScreen(result, PATH);

  const t = await getTranslations("reports.soaPage");
  const soa = result.data;
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <a href="/reports" className="text-[13px] font-semibold text-accent">
          {t("back")}
        </a>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
        {gone && soa.framework ? (
          <p role="status" className={noticeClass}>
            {t("frameworkGone", {
              label: `${soa.framework.name} ${soa.framework.versionLabel}`,
            })}
          </p>
        ) : null}
      </Entrance>
      <Entrance order={1} className="flex flex-col gap-4">
        <SoaToolbar
          frameworks={soa.frameworks}
          framework={soa.framework}
          undecided={onlyUndecided}
        />
        {soa.framework ? (
          <SoaTable soa={soa} onlyUndecided={onlyUndecided} timeZone={timeZone} />
        ) : (
          <p className="text-sm text-fg-muted">{t("noFramework")}</p>
        )}
      </Entrance>
    </div>
  );
}
