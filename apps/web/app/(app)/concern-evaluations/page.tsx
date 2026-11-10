import { concernRewardRoutes } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { JudgmentForm } from "../../../components/rewards/judgment-form";
import { glass } from "../../../components/setup/styles";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/concern-evaluations";
const tm = createTranslator({ locale: "en", messages });
export const metadata: Metadata = { title: tm("judgments.pageTitle", { app: tm("app.name") }) };

export default async function ConcernEvaluationsPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("concerns.judge")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const result = await callApi(concernRewardRoutes.queue, {}, { returnTo: PATH });
  if (!result.ok) return failureScreen(result, PATH);
  const t = await getTranslations("judgments");
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[74ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      {result.data.items.length === 0 ? (
        <p className={`${glass} p-6 text-sm text-fg-muted`}>{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {result.data.items.map((item, index) => (
            <Entrance key={item.evaluation.id} order={Math.min(index + 1, 4)}>
              <article className={`${glass} flex flex-col gap-5 p-5 sm:p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-accent">
                      {item.evaluation.riskReference}
                    </p>
                    <h2 className="text-lg font-bold text-fg">{item.title}</h2>
                    <p className="text-sm text-fg-muted">{item.reporter.displayName}</p>
                  </div>
                  <div className="text-right text-xs font-semibold text-fg-muted">
                    <p>{item.evaluation.source === "ai" ? t("ai") : t("pending")}</p>
                    {item.evaluation.confidence !== null ? (
                      <p>
                        {t("confidence", { percent: Math.round(item.evaluation.confidence * 100) })}
                      </p>
                    ) : null}
                  </div>
                </div>
                {item.failureReason ? (
                  <p className="rounded-lg bg-attention-soft px-3 py-2 text-sm text-fg">
                    {t("failure", { reason: item.failureReason })}
                  </p>
                ) : null}
                {item.rationale ? (
                  <div>
                    <p className="text-xs font-bold text-fg-muted">{t("rationale")}</p>
                    <p className="text-sm text-fg">{item.rationale}</p>
                  </div>
                ) : null}
                {item.uncertainty ? (
                  <div>
                    <p className="text-xs font-bold text-fg-muted">{t("uncertainty")}</p>
                    <p className="text-sm text-fg">{item.uncertainty}</p>
                  </div>
                ) : null}
                <JudgmentForm item={item} />
              </article>
            </Entrance>
          ))}
        </div>
      )}
    </div>
  );
}
