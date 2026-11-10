import { concernRewardRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { SecurityContributionView } from "../../../components/rewards/security-contribution-view";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/security-contribution";
const tm = createTranslator({ locale: "en", messages });
export const metadata: Metadata = { title: tm("rewards.pageTitle", { app: tm("app.name") }) };

export default async function SecurityContributionPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("risks.report")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const result = await callApi(concernRewardRoutes.contribution, {}, { returnTo: PATH });
  if (!result.ok) return failureScreen(result, PATH);
  const t = await getTranslations("rewards");
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[70ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <SecurityContributionView contribution={result.data} />
      </Entrance>
    </div>
  );
}
