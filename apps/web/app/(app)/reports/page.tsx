import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { ReportsHub } from "../../../components/reports/reports-hub";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import messages from "../../../messages/index";

const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("reports.pageTitle", { app: tm("app.name") }),
};

/** The reports hub: the risk register, the Statement of Applicability and the board pack. */
export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("reports.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const t = await getTranslations("reports");
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
        <ReportsHub />
      </Entrance>
    </div>
  );
}
