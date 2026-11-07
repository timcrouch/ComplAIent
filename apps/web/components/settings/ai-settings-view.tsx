"use client";

import type { AiModelListResponse, AiSettingsDto } from "@isms/contracts";
import { StatusBadge, type Status } from "@isms/ui";
import { CircleCheckIcon, CirclePauseIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { Entrance } from "../motion/entrance";
import { glass } from "../setup/styles";
import { ConnectionTest } from "./connection-test";
import { KeyForm } from "./key-form";
import { ModelPickers, type ModelsUnavailable } from "./model-pickers";
import { MasterSwitch, PrivacySwitches } from "./privacy-switches";
import { purposeReadiness, type PurposeState } from "./readiness";

type AiSettingsViewProps = {
  settings: AiSettingsDto;
  offered: AiModelListResponse["models"] | null;
  modelsUnavailable: ModelsUnavailable | null;
  timeZone: string;
};

const PURPOSE_STATUS: Record<PurposeState, Status> = {
  ready: "ok",
  noModel: "attention",
  waiting: "unknown",
};

/**
 * Settings → AI assistant. Each section saves on its own and hands back the settings the API
 * returned, so the readiness summary at the top follows every change. The server page is
 * revalidated too, which refreshes the model list after a key or privacy change.
 */
export function AiSettingsView({
  settings: initial,
  offered,
  modelsUnavailable,
  timeZone,
}: AiSettingsViewProps) {
  const t = useTranslations("settings.ai");
  // Adopt fresh server props (after revalidation) while keeping the latest action result.
  const [fromServer, setFromServer] = useState(initial);
  const [settings, setSettings] = useState(initial);
  if (initial !== fromServer) {
    setFromServer(initial);
    setSettings(initial);
  }

  return (
    <div className="flex flex-col gap-5">
      <Entrance order={1}>
        <ReadinessSummary settings={settings} />
      </Entrance>
      <Entrance order={2} className="flex flex-col gap-5">
        <Section title={t("key.title")} description={t("key.description")}>
          <KeyForm
            keyStatus={settings.key}
            secretsKeyConfigured={settings.secretsKeyConfigured}
            timeZone={timeZone}
            onSaved={setSettings}
          />
        </Section>
        <Section title={t("privacy.title")} description={t("privacy.description")}>
          <PrivacySwitches
            euOnly={settings.euOnly}
            zeroRetention={settings.zeroRetention}
            nonEuRoutingAllowed={settings.nonEuRoutingAllowed}
            onSaved={setSettings}
          />
        </Section>
        <Section title={t("models.title")} description={t("models.description")}>
          <ModelPickers
            models={settings.models}
            offered={offered}
            unavailable={modelsUnavailable}
            onSaved={setSettings}
          />
        </Section>
        <Section title={t("test.title")} description={t("test.description")}>
          <ConnectionTest />
        </Section>
        <Section title={t("master.title")}>
          <MasterSwitch enabled={settings.enabled} onSaved={setSettings} />
        </Section>
      </Entrance>
    </div>
  );
}

const OVERALL: Record<"ready" | "disabled" | "other", { icon: LucideIcon; tone: string }> = {
  ready: { icon: CircleCheckIcon, tone: "text-ok" },
  disabled: { icon: CirclePauseIcon, tone: "text-fg-muted" },
  other: { icon: TriangleAlertIcon, tone: "text-attention" },
};

/** Where AI stands, in words with an icon: overall, then for each purpose. */
function ReadinessSummary({ settings }: { settings: AiSettingsDto }) {
  const t = useTranslations("settings.ai.readiness");
  const id = useId();
  const { ready, reason } = settings.readiness;
  const overall = ready ? OVERALL.ready : reason === "disabled" ? OVERALL.disabled : OVERALL.other;
  const Icon = overall.icon;
  // With the development opt-in only zero retention can be what is missing.
  const overallKey =
    reason === "privacyOff" && settings.nonEuRoutingAllowed
      ? "privacyOffZeroRetention"
      : (reason ?? "ready");
  return (
    <section aria-labelledby={`${id}-title`} className={`${glass} flex flex-col gap-3 p-5`}>
      <h2 id={`${id}-title`} className="text-[13px] font-semibold text-fg-muted">
        {t("title")}
      </h2>
      <p className="flex items-start gap-2.5 text-[15px] font-semibold text-fg">
        <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${overall.tone}`} />
        <span>{t(`overall.${overallKey}`)}</span>
      </p>
      <ul aria-label={t("purposesLabel")} className="flex flex-wrap gap-2">
        {purposeReadiness(settings).map(({ purpose, state }) => (
          <li key={purpose}>
            <StatusBadge status={PURPOSE_STATUS[state]} label={t(`${purpose}.${state}`)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className={`${glass} flex flex-col gap-4 p-5 sm:p-6`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold tracking-[-0.01em] text-fg">
          {title}
        </h2>
        {description ? (
          <p className="max-w-[72ch] text-[13px] leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
