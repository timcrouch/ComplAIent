"use client";

import type { AiModelListResponse, AiModelsDto, AiSettingsDto } from "@isms/contracts";
import { Button, Field, Select } from "@isms/ui";
import { CircleCheckIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type SubmitEvent } from "react";
import type messages from "../../messages/index";
import { updateAiSettings } from "../../lib/actions/ai-settings";
import { PURPOSES } from "./readiness";
import { SettingsError, useSettingsCall } from "./settings-call";

export type ModelsUnavailable = keyof (typeof messages)["settings"]["ai"]["models"]["unavailable"];
type Offered = AiModelListResponse["models"];

type ModelPickersProps = {
  models: AiModelsDto;
  /** The models the provider offers under EU routing and zero retention; null when unlisted. */
  offered: Offered | null;
  /** Why the models could not be listed. */
  unavailable: ModelsUnavailable | null;
  onSaved: (settings: AiSettingsDto) => void;
};

/** One model per purpose, from the provider's list; "Not chosen" leaves a purpose without AI. */
export function ModelPickers({ models, offered, unavailable, onSaved }: ModelPickersProps) {
  const t = useTranslations("settings.ai.models");
  const tp = useTranslations("settings.ai.purposes");
  const id = useId();
  const { busy, error, run } = useSettingsCall();
  const [chosen, setChosen] = useState<AiModelsDto>(models);
  const [saved, setSaved] = useState(false);

  if (!offered) {
    return (
      <p className="flex items-start gap-2 rounded-md bg-info-soft/70 px-3.5 py-3 text-sm text-fg">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <span>{t(`unavailable.${unavailable ?? "provider"}`)}</span>
      </p>
    );
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSaved(false);
    const result = await run(() => updateAiSettings({ models: chosen }));
    if (!result) return;
    setChosen(result.models);
    setSaved(true);
    onSaved(result);
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        {PURPOSES.map((purpose) => {
          const fieldId = `${id}-${purpose}`;
          const current = chosen[purpose];
          // A saved model the provider no longer lists stays visible until it is changed.
          const options =
            current && !offered.some((m) => m.id === current)
              ? [...offered, { id: current, name: current }]
              : offered;
          return (
            <Field key={purpose} id={fieldId} label={tp(purpose)}>
              <Select
                id={fieldId}
                value={current ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setSaved(false);
                  setChosen((c) => ({ ...c, [purpose]: value === "" ? null : value }));
                }}
              >
                <option value="">{t("notChosen")}</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={busy} focusableWhenDisabled className="w-full sm:w-auto">
          {busy ? t("saving") : t("save")}
        </Button>
        <p
          role="status"
          className="flex min-h-5 items-center gap-1.5 text-sm font-medium text-fg-muted"
        >
          {saved ? <CircleCheckIcon aria-hidden className="size-4 text-ok" /> : null}
          {saved ? t("saved") : ""}
        </p>
      </div>
      <SettingsError error={error} />
    </form>
  );
}
