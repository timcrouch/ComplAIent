"use client";

import { SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { resumeConcernRewards, updateConcernRewards } from "../../lib/actions/concern-rewards";
import { SettingsError, useSettingsCall } from "./settings-call";
import { SwitchRow } from "./switch-row";

export function ConcernRewardsSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const t = useTranslations("settings.concernReporting");
  const { busy, error, run } = useSettingsCall();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [announced, setAnnounced] = useState("");

  async function save(next: boolean) {
    setAnnounced("");
    const saved = await run(() => updateConcernRewards({ enabled: next }));
    if (!saved) return;
    setEnabled(saved.enabled);
    setAnnounced(saved.enabled ? t("savedOn") : t("savedOff"));
  }

  async function resume() {
    setAnnounced("");
    const result = await run(resumeConcernRewards);
    if (result) setAnnounced(t("resumed", { count: result.queued }));
  }

  return (
    <div className="flex flex-col gap-4">
      <SwitchRow
        label={t("switchLabel")}
        hint={t("switchHint")}
        checked={enabled}
        busy={busy}
        onChange={(next) => void save(next)}
      />
      <div
        className={`flex items-start gap-3 rounded-xl px-4 py-3.5 ${
          enabled ? "bg-accent-soft" : "bg-[color-mix(in_oklab,var(--isms-text)_5%,transparent)]"
        }`}
      >
        {enabled ? (
          <SparklesIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        ) : (
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" />
        )}
        <p className="text-sm leading-relaxed text-fg">
          {enabled ? t("enabledExplanation") : t("disabledExplanation")}
        </p>
      </div>
      <SettingsError error={error} />
      {enabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void resume()}
          className="self-start rounded-lg border border-control-border px-3.5 py-2 text-sm font-semibold text-fg hover:bg-control-hover disabled:opacity-60"
        >
          {busy ? t("resuming") : t("resume")}
        </button>
      ) : null}
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}
