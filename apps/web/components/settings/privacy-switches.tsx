"use client";

import type { AiSettingsDto } from "@isms/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateAiSettings } from "../../lib/actions/ai-settings";
import { SettingsError, useSettingsCall } from "./settings-call";
import { SwitchRow } from "./switch-row";

type OnSaved = (settings: AiSettingsDto) => void;

/**
 * EU-only routing and zero data retention, saved as soon as they change. While either is
 * off, no AI request leaves the workspace, and the page says so.
 */
export function PrivacySwitches({
  euOnly,
  zeroRetention,
  nonEuRoutingAllowed = false,
  onSaved,
}: {
  euOnly: boolean;
  zeroRetention: boolean;
  /** Development only: AI may run with EU-only routing off (zero retention is still required). */
  nonEuRoutingAllowed?: boolean;
  onSaved: OnSaved;
}) {
  const t = useTranslations("settings.ai.privacy");
  const { busy, error, run } = useSettingsCall();
  const [announced, setAnnounced] = useState("");

  async function save(change: { euOnly: boolean } | { zeroRetention: boolean }) {
    setAnnounced("");
    const saved = await run(() => updateAiSettings(change));
    if (!saved) return;
    setAnnounced(t("saved"));
    onSaved(saved);
  }

  // With the development opt-in, EU-only may be off while AI still runs; zero retention may not.
  const notice = !zeroRetention
    ? nonEuRoutingAllowed
      ? "pausedZeroRetention"
      : "paused"
    : euOnly
      ? null
      : nonEuRoutingAllowed
        ? "nonEuWarning"
        : "paused";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-[color-mix(in_oklab,var(--isms-text)_8%,transparent)]">
        <SwitchRow
          label={t("euOnly")}
          hint={t("euOnlyHint")}
          checked={euOnly}
          busy={busy}
          onChange={(on) => void save({ euOnly: on })}
        />
        <SwitchRow
          label={t("zeroRetention")}
          hint={t("zeroRetentionHint")}
          checked={zeroRetention}
          busy={busy}
          onChange={(on) => void save({ zeroRetention: on })}
        />
      </div>
      {notice ? (
        <p className="flex items-start gap-2 rounded-md bg-attention-soft px-3.5 py-3 text-sm font-medium text-fg">
          <TriangleAlertIcon aria-hidden className="mt-px size-4 shrink-0 text-attention" />
          <span>{t(notice)}</span>
        </p>
      ) : null}
      <SettingsError error={error} />
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}

/** The master switch: with it off, nobody is offered AI help anywhere. */
export function MasterSwitch({ enabled, onSaved }: { enabled: boolean; onSaved: OnSaved }) {
  const t = useTranslations("settings.ai.master");
  const { busy, error, run } = useSettingsCall();
  const [announced, setAnnounced] = useState("");

  async function save(on: boolean) {
    setAnnounced("");
    const saved = await run(() => updateAiSettings({ enabled: on }));
    if (!saved) return;
    setAnnounced(saved.enabled ? t("on") : t("off"));
    onSaved(saved);
  }

  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label={t("label")}
        hint={t("hint")}
        checked={enabled}
        busy={busy}
        onChange={(on) => void save(on)}
      />
      <SettingsError error={error} />
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}
