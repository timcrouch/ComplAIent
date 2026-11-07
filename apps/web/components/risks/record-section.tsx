"use client";

import type { AssetInput, RiskDetailDto } from "@isms/contracts";
import { DetailList } from "@isms/ui";
import { useTranslations } from "next-intl";
import { AssetsEditor } from "./assets-editor";
import { areaEditor, selectEditor, textEditor, type Option } from "./inline-editors";
import { InlineField } from "./inline-field";
import { useRisk } from "./risk-context";
import { Section } from "./section";

export type Unit = { id: string; name: string };
type Scope = { type: "organisation" | "site" | "department"; id: string | null };
/** Someone who holds risk_owner or ciso, with where they hold it. */
export type OwnerCandidate = { id: string; displayName: string; scopes: Scope[] };

type RecordSectionProps = {
  sites: readonly Unit[];
  departments: readonly Unit[];
  /** Null when the viewer may not list people; the owner is then shown, not edited. */
  owners: readonly OwnerCandidate[] | null;
};

type TextKey = "title" | "scenario" | "threat" | "consequence" | "existingSafeguards";
const TEXT_FIELDS: readonly { key: TextKey; max: number; multiline: boolean }[] = [
  { key: "title", max: 120, multiline: false },
  { key: "scenario", max: 2000, multiline: true },
  { key: "threat", max: 1000, multiline: true },
  { key: "consequence", max: 1000, multiline: true },
  { key: "existingSafeguards", max: 1000, multiline: true },
];

/** Eligible where the risk now belongs: organisation-wide, or at its site or department. */
function eligible(owner: OwnerCandidate, risk: RiskDetailDto): boolean {
  return owner.scopes.some(
    (s) =>
      s.type === "organisation" ||
      (s.type === "site" && s.id === risk.siteId) ||
      (s.type === "department" && s.id === risk.departmentId),
  );
}

const unitOptions = (units: readonly Unit[]): Option[] =>
  units.map((u) => ({ value: u.id, label: u.name }));

/** The technical record: what could happen, why, to what, where, and who owns it. */
export function RecordSection({ sites, departments, owners }: RecordSectionProps) {
  const t = useTranslations("risks.record");
  const ti = useTranslations("risks.inline");
  const kinds = useTranslations("report.assetTypes");
  const { risk } = useRisk();
  const edit = risk.can.edit;
  const assets: AssetInput[] = risk.assets.map(({ name, type }) => ({ name, type }));

  const ownerOptions: Option[] = [
    { value: "", label: t("noOwner") },
    ...(owners ?? [])
      .filter((o) => eligible(o, risk) || o.id === risk.owner?.id)
      .map((o) => ({ value: o.id, label: o.displayName })),
  ];

  return (
    <Section title={t("title")}>
      <DetailList>
        {TEXT_FIELDS.map(({ key, max, multiline }) => (
          <InlineField
            key={key}
            label={t(`fields.${key}`)}
            value={risk[key]}
            display={risk[key]}
            empty={ti("empty")}
            emphasis={multiline ? "long" : "short"}
            toChanges={edit ? (draft) => ({ [key]: draft.trim() }) : null}
            editor={multiline ? areaEditor(max) : textEditor(max)}
          />
        ))}
        <InlineField
          label={t("fields.assets")}
          group="group"
          value={assets}
          empty={t("noAssets")}
          display={
            assets.length === 0 ? null : (
              <ul className="flex flex-col gap-1">
                {assets.map((a, i) => (
                  <li key={i}>{t("assetLine", { name: a.name, kind: kinds(a.type) })}</li>
                ))}
              </ul>
            )
          }
          toChanges={
            edit ? (draft) => ({ assets: draft.map((a) => ({ ...a, name: a.name.trim() })) }) : null
          }
          editor={(props) => <AssetsEditor {...props} />}
        />
        <InlineField
          label={t("fields.site")}
          value={risk.siteId}
          display={risk.siteName}
          empty={t("noSite")}
          toChanges={edit ? (draft) => ({ siteId: draft }) : null}
          editor={selectEditor([{ value: "", label: t("noSite") }, ...unitOptions(sites)])}
        />
        {departments.length > 0 ? (
          <InlineField
            label={t("fields.department")}
            value={risk.departmentId}
            display={departments.find((d) => d.id === risk.departmentId)?.name}
            empty={t("noDepartment")}
            toChanges={edit ? (draft) => ({ departmentId: draft }) : null}
            editor={selectEditor([
              { value: "", label: t("noDepartment") },
              ...unitOptions(departments),
            ])}
          />
        ) : null}
        <InlineField
          label={t("fields.owner")}
          hint={t("ownerHint")}
          value={risk.owner?.id ?? null}
          display={risk.owner?.displayName}
          empty={t("noOwner")}
          toChanges={edit && owners ? (draft) => ({ ownerId: draft }) : null}
          editor={selectEditor(ownerOptions)}
        />
      </DetailList>
    </Section>
  );
}
