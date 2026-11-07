"use client";

import type { RiskScaleDto } from "@isms/contracts";
import { AiBadge, Button, DetailItem, DetailList, Select } from "@isms/ui";
import { WandSparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { updateRisk } from "../../lib/actions/risks";
import type { EditorProps } from "./inline-field";
import { InlineField } from "./inline-field";
import { ScoreBadges } from "./risk-badges";
import { useRisk } from "./risk-context";
import { Section } from "./section";
import { useControlAction } from "./use-control-action";

type Levels = { likelihood: number | null; impact: number | null };
type Axis = keyof Levels;
const AXES: readonly Axis[] = ["likelihood", "impact"];

function useLevelText(scale: RiskScaleDto) {
  const t = useTranslations("risks.assessment");
  return (axis: Axis, value: number | null) => {
    if (value === null) return t("notSet");
    const label = scale[axis].find((l) => l.value === value)?.label ?? "";
    return t("level", { value, label });
  };
}

function LevelsEditor({
  id,
  draft,
  setDraft,
  scale,
}: EditorProps<Levels> & { scale: RiskScaleDto }) {
  const t = useTranslations("risks.assessment");
  const levelText = useLevelText(scale);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {AXES.map((axis) => (
        <div key={axis} className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-${axis}`} className="text-[13px] font-semibold text-fg">
            {t(axis)}
          </label>
          <Select
            id={`${id}-${axis}`}
            value={draft[axis] === null ? "" : String(draft[axis])}
            onChange={(e) => {
              const value = e.target.value === "" ? null : Number(e.target.value);
              setDraft({ ...draft, [axis]: value });
            }}
          >
            <option value="">{t("notSet")}</option>
            {scale[axis].map((l) => (
              <option key={l.value} value={l.value}>
                {levelText(axis, l.value)}
              </option>
            ))}
          </Select>
        </div>
      ))}
    </div>
  );
}

/**
 * The official likelihood and impact on the organisation's scale, set only by a person. The
 * AI's estimate sits beside them, labelled, as a hint; "Use the AI estimate" is an ordinary edit.
 */
export function AssessmentSection({ scale }: { scale: RiskScaleDto }) {
  const t = useTranslations("risks.assessment");
  const { risk } = useRisk();
  const levelText = useLevelText(scale);
  const { busy, run, notices } = useControlAction();
  const estimateButton = useRef<HTMLButtonElement>(null);
  const levels: Levels = { likelihood: risk.likelihood, impact: risk.impact };
  const estimate = risk.aiEstimate;

  async function applyEstimate() {
    if (!estimate) return;
    await run(
      (version) =>
        updateRisk(risk.id, version, { likelihood: estimate.likelihood, impact: estimate.impact }),
      () => t("ai.used"),
    );
  }

  return (
    <Section title={t("title")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div data-testid="official-assessment" className="flex flex-col gap-2">
          {/* The score follows from the levels: one group, so no divider between them. */}
          <DetailList className="divide-y-0">
            <InlineField
              label={t("fieldLabel")}
              group="group"
              value={levels}
              display={
                <DetailList density="compact">
                  {AXES.map((axis) => (
                    <DetailItem key={axis} label={t(axis)} empty={t("notSet")}>
                      {levels[axis] === null ? null : levelText(axis, levels[axis])}
                    </DetailItem>
                  ))}
                </DetailList>
              }
              toChanges={risk.can.edit ? (draft) => draft : null}
              editor={(props) => <LevelsEditor {...props} scale={scale} />}
            />
            <DetailItem label={t("score")}>
              <ScoreBadges score={risk.score} aboveAppetite={risk.aboveAppetite} outOf />
            </DetailItem>
          </DetailList>
        </div>
        {estimate ? (
          <div
            data-testid="ai-estimate"
            className="flex flex-col items-start gap-2 rounded-md border border-dashed border-[color-mix(in_oklab,var(--isms-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--isms-accent)_5%,transparent)] p-4"
          >
            <AiBadge state="suggested" label={t("ai.badge")} />
            <p className="text-[14px] font-semibold text-fg">
              {t("ai.values", {
                likelihood: levelText("likelihood", estimate.likelihood),
                impact: levelText("impact", estimate.impact),
              })}
            </p>
            <p className="text-[14px] leading-relaxed whitespace-pre-line text-fg">
              {estimate.reasoning}
            </p>
            <p className="text-[13px] text-fg-muted">{t("ai.hint")}</p>
            {risk.can.edit ? (
              <Button
                ref={estimateButton}
                type="button"
                size="sm"
                variant="secondary"
                aria-disabled={busy || undefined}
                onClick={() => void applyEstimate()}
              >
                <WandSparklesIcon aria-hidden />
                {t("ai.use")}
              </Button>
            ) : null}
            {notices(() => estimateButton.current?.focus())}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
