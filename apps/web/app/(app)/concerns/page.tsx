import { riskRoutes } from "@isms/contracts";
import { buttonVariants } from "@isms/ui";
import { MessageSquareWarningIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { ConcernList } from "../../../components/report/concern-list";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../lib/greeting";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/concerns";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("concerns.pageTitle", { app: tm("app.name") }),
};

/** The concerns the viewer reported, with where each one stands. */
export default async function ConcernsPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("risks.report")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }

  const concerns = await callApi(riskRoutes.myConcerns, {}, { returnTo: PATH });
  if (!concerns.ok) return failureScreen(concerns, PATH);

  const t = await getTranslations("concerns");
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
            {t("title")}
          </h1>
          {concerns.data.items.length > 0 ? (
            <Link href="/report" className={buttonVariants({ variant: "secondary" })}>
              <MessageSquareWarningIcon aria-hidden />
              {t("reportNew")}
            </Link>
          ) : null}
        </div>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <ConcernList items={concerns.data.items} timeZone={timeZone} />
      </Entrance>
    </div>
  );
}
