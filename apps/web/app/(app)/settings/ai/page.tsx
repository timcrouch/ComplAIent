import { aiSettingsRoutes, conflictReasons } from "@isms/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AiSettingsView } from "../../../../components/settings/ai-settings-view";
import type { ModelsUnavailable } from "../../../../components/settings/model-pickers";
import { Entrance } from "../../../../components/motion/entrance";
import { StatusScreen } from "../../../../components/status/status-screen";
import { SettingsNav } from "../../../../components/settings/settings-nav";
import { requireViewer } from "../../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { failureScreen } from "../../../../lib/page-result";
import { callApi, type CallResult } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const PATH = "/settings/ai";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = {
  title: tm("settings.ai.pageTitle", { app: tm("app.name") }),
};

/** Why the model list is missing: the API refuses to list models until a key and privacy are set. */
function unavailableReason(result: CallResult<unknown>): ModelsUnavailable {
  if (result.ok || result.kind !== "conflict") return "provider";
  const first = conflictReasons(result.details)[0];
  if (first?.reason === "secretsKeyMissing" || first?.reason === "keyUnreadable") {
    return first.reason;
  }
  if (
    first?.reason === "aiUnavailable" &&
    (first.item === "privacyOff" || first.item === "noKey")
  ) {
    return first.item;
  }
  return "provider";
}

/** Settings → AI assistant, for administrators (settings.ai.manage). */
export default async function AiSettingsPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("settings.ai.manage")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }

  const [settings, models] = await Promise.all([
    callApi(aiSettingsRoutes.get, {}, { returnTo: PATH }),
    callApi(aiSettingsRoutes.listModels, {}, { returnTo: PATH }),
  ]);
  if (!settings.ok) return failureScreen(settings, PATH);
  // A missing model list is part of the page (no key yet, privacy off), not a failure.
  if (!models.ok && models.kind !== "conflict" && models.kind !== "unavailable") {
    return failureScreen(models, PATH);
  }

  const t = await getTranslations("settings.ai");
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <SettingsNav current="ai" permissions={viewer.me.permissions} />
      <Entrance className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
          {t("title")}
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </Entrance>
      <AiSettingsView
        settings={settings.data}
        offered={models.ok ? models.data.models : null}
        modelsUnavailable={models.ok ? null : unavailableReason(models)}
        timeZone={timeZone}
      />
    </div>
  );
}
