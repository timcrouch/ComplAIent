import { concernRoutes, organisationRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { ReportFlow } from "../../../components/report/report-flow";
import { focusRingClass } from "../../../components/shell/styles";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/report";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("report.pageTitle", { app: tm("app.name") }),
};

type ReportPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Report a concern: by conversation when the AI can run a turn, otherwise (or with
 * `?mode=form`) with the step form. Every signed-in reporter may read the site names.
 */
export default async function ReportPage({ searchParams }: ReportPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("risks.report")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }

  const [status, organisation] = await Promise.all([
    callApi(concernRoutes.aiStatus, {}, { returnTo: PATH }),
    callApi(organisationRoutes.get, {}, { returnTo: PATH }),
  ]);
  if (!organisation.ok) return failureScreen(organisation, PATH);
  // An unknown AI status is not a failure: the form always works.
  if (!status.ok && status.kind !== "unavailable") return failureScreen(status, PATH);

  const t = await getTranslations("report");
  const startInForm = (await searchParams).mode === "form";
  const sites = organisation.data.sites.map(({ id, name }) => ({ id, name }));

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
          <Link
            href="/concerns"
            className={`inline-flex min-h-6 items-center rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline ${focusRingClass}`}
          >
            {t("yourConcerns")}
          </Link>
        </div>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <ReportFlow
          key={startInForm ? "form" : "chat"}
          aiAvailable={status.ok && status.data.available}
          startInForm={startInForm}
          sites={sites}
          rewardsEnabled={organisation.data.concernRewards.enabled}
          initialRank={viewer.me.concernRank}
        />
      </Entrance>
    </div>
  );
}
