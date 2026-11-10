import { organisationRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../../components/motion/entrance";
import { ConcernRewardsCatalog } from "../../../../components/settings/concern-rewards-catalog";
import { ConcernRewardsSwitch } from "../../../../components/settings/concern-rewards-switch";
import { SettingsNav } from "../../../../components/settings/settings-nav";
import { glass } from "../../../../components/setup/styles";
import { StatusScreen } from "../../../../components/status/status-screen";
import { requireViewer } from "../../../../lib/current-viewer";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const PATH = "/settings/concern-reporting";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("settings.concernReporting.pageTitle", { app: tm("app.name") }),
};

export default async function ConcernReportingSettingsPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("organisation.manage")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const organisation = await callApi(organisationRoutes.get, {}, { returnTo: PATH });
  if (!organisation.ok) return failureScreen(organisation, PATH);
  const t = await getTranslations("settings.concernReporting");

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <SettingsNav current="concern-reporting" permissions={viewer.me.permissions} />
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <section className={`${glass} flex flex-col gap-4 p-5 sm:p-6`}>
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">
              {t("sectionTitle")}
            </h2>
            <p className="max-w-[72ch] text-[13px] leading-relaxed text-fg-muted">
              {t("sectionDescription")}
            </p>
          </div>
          <ConcernRewardsSwitch initialEnabled={organisation.data.concernRewards.enabled} />
        </section>
      </Entrance>
      <Entrance order={2}>
        <section className={`${glass} p-5 sm:p-6`}>
          <ConcernRewardsCatalog />
        </section>
      </Entrance>
    </div>
  );
}
