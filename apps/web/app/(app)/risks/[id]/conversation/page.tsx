import { concernRoutes, riskRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Entrance } from "../../../../../components/motion/entrance";
import { Transcript } from "../../../../../components/risks/transcript";
import { focusRingClass } from "../../../../../components/shell/styles";
import { StatusScreen } from "../../../../../components/status/status-screen";
import { requireViewer } from "../../../../../lib/current-viewer";
import { failureScreen } from "../../../../../lib/page-result";
import { callApi } from "../../../../../lib/server-api";
import messages from "../../../../../messages/index";

const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("risks.transcript.pageTitle", { app: tm("app.name") }),
};

type ConversationPageProps = { params: Promise<{ id: string }> };

/** The conversation a risk was reported through, read-only (reporter, admins, transcript readers). */
export default async function ConversationPage({ params }: ConversationPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("risks.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `/risks/${id}/conversation`;

  const [risk, transcript] = await Promise.all([
    callApi(riskRoutes.get, { params: { id } }, { returnTo: path }),
    callApi(concernRoutes.transcript, { params: { id } }, { returnTo: path }),
  ]);
  if (!risk.ok) return failureScreen(risk, path);
  if (!transcript.ok) return failureScreen(transcript, path);

  const t = await getTranslations("risks.transcript");
  const { reference } = risk.data;
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <Link
          href={`/risks/${id}`}
          className={`inline-flex min-h-6 w-fit items-center rounded-sm text-sm font-semibold text-accent underline-offset-4 hover:underline ${focusRingClass}`}
        >
          {t("back", { reference })}
        </Link>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title", { reference })}
        </h1>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <Entrance order={1}>
        <Transcript transcript={transcript.data} />
      </Entrance>
    </div>
  );
}
