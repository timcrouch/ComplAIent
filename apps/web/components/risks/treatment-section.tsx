"use client";

import { TreatmentSchema, type PersonRef, type RiskScaleDto } from "@isms/contracts";
import type { Treatment } from "@isms/domain";
import { useTranslations } from "next-intl";
import { DetailItem, DetailList, Select } from "@isms/ui";
import { choiceCard, choiceInput } from "../setup/styles";
import { areaEditor } from "./inline-editors";
import { InlineField, type EditorProps } from "./inline-field";
import { useRisk } from "./risk-context";
import { Section } from "./section";
import { TreatmentPlan } from "./treatment-plan";

/** Plain words first, the correct term beneath (UX directive). */
function TreatmentWords({ treatment }: { treatment: Treatment }) {
  const t = useTranslations("risks.treatment");
  return (
    <span className="flex flex-col">
      <span className="font-semibold text-fg">{t(`${treatment}.label`)}</span>{" "}
      <span className="text-[13px] text-fg-muted">
        {t("term", { term: t(`${treatment}.term`) })}
      </span>
    </span>
  );
}

function TreatmentEditor({ id, draft, setDraft }: EditorProps<Treatment | null>) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {TreatmentSchema.options.map((treatment) => (
        <label key={treatment} className={choiceCard}>
          <input
            type="radio"
            name={`${id}-treatment`}
            value={treatment}
            checked={draft === treatment}
            onChange={() => {
              setDraft(treatment);
            }}
            className={choiceInput}
          />
          <TreatmentWords treatment={treatment} />
        </label>
      ))}
    </div>
  );
}

type Levels = { likelihood: number | null; impact: number | null };
const AXES = ["likelihood", "impact"] as const;

function useResidualText(scale: RiskScaleDto) {
  const t = useTranslations("insights.residual");
  return (axis: (typeof AXES)[number], value: number | null) => {
    if (value === null) return t("notSet");
    const label = scale[axis].find((l) => l.value === value)?.label ?? "";
    return t("level", { value, label });
  };
}

function ResidualEditor({
  id,
  draft,
  setDraft,
  scale,
}: EditorProps<Levels> & { scale: RiskScaleDto }) {
  const t = useTranslations("insights.residual");
  const levelText = useResidualText(scale);
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
              setDraft({ ...draft, [axis]: e.target.value === "" ? null : Number(e.target.value) });
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

/** How the risk will be handled, in plain words, and a note on how. */
export function TreatmentSection({
  scale,
  people = null,
}: {
  scale: RiskScaleDto;
  /** Who an action can be assigned to; null when the viewer may not list people. */
  people?: readonly PersonRef[] | null;
}) {
  const t = useTranslations("risks.treatment");
  const tr = useTranslations("insights.residual");
  const levelText = useResidualText(scale);
  const { risk } = useRisk();
  const edit = risk.can.edit;
  return (
    <Section title={t("title")}>
      <DetailList>
        <InlineField
          label={t("fieldLabel")}
          group="radiogroup"
          value={risk.treatment}
          display={risk.treatment ? <TreatmentWords treatment={risk.treatment} /> : null}
          empty={t("notChosen")}
          toChanges={edit ? (draft) => ({ treatment: draft }) : null}
          editor={(props) => <TreatmentEditor {...props} />}
        />
        {risk.treatment !== "accept" ? (
          <InlineField
            label={tr("fieldLabel")}
            group="group"
            hint={tr("hint")}
            value={{ likelihood: risk.residualLikelihood, impact: risk.residualImpact }}
            display={
              <DetailList density="compact">
                {AXES.map((axis) => {
                  const level = axis === "impact" ? risk.residualImpact : risk.residualLikelihood;
                  return (
                    <DetailItem key={axis} label={tr(axis)} empty={tr("notSet")}>
                      {level === null ? null : levelText(axis, level)}
                    </DetailItem>
                  );
                })}
              </DetailList>
            }
            toChanges={
              edit
                ? (draft) => ({
                    residualLikelihood: draft.likelihood,
                    residualImpact: draft.impact,
                  })
                : null
            }
            editor={(props) => <ResidualEditor {...props} scale={scale} />}
          />
        ) : null}
        <InlineField
          label={t("noteLabel")}
          value={risk.treatmentNote}
          display={risk.treatmentNote}
          empty={t("notChosen")}
          emphasis="long"
          toChanges={edit ? (draft) => ({ treatmentNote: draft.trim() }) : null}
          editor={areaEditor(2000)}
        />
      </DetailList>
      <TreatmentPlan people={people} />
    </Section>
  );
}
