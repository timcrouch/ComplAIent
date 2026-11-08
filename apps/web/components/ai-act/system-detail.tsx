"use client";

import type { AiSystemDetailDto } from "@isms/contracts";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ClassBadge } from "./badges";
import { ClassificationSection } from "./classification-section";
import { ModuleHeader } from "./module-header";
import { ObligationsSection } from "./obligations-section";
import { ProfileSection } from "./profile-section";
import { RiskLinksSection, type RiskOption } from "./risk-links-section";

export type SystemDetailProps = {
  initial: AiSystemDetailDto;
  /** aiact.manage: edit the profile, classify, update obligations. */
  canManage: boolean;
  /** risks.read: the linked risks are shown. */
  canReadRisks: boolean;
  /** Risks to link from; null unless the viewer holds aiact.manage and risks.read. */
  riskOptions: readonly RiskOption[] | null;
  timeZone: string;
};

/**
 * One AI system: profile, classification, obligations and linked risks. Every change returns
 * the whole system from the API, which replaces what is on screen (counts and lists stay true).
 */
export function SystemDetail({
  initial,
  canManage,
  canReadRisks,
  riskOptions,
  timeZone,
}: SystemDetailProps) {
  const t = useTranslations("aiAct");
  const [system, setSystem] = useState(initial);
  return (
    <div className="flex flex-col gap-6">
      <ModuleHeader
        title={system.name}
        back={{ href: "/ai-act", label: t("back") }}
        badges={
          <>
            <ClassBadge riskClass={system.riskClass} />
            <span className="text-[13px] font-semibold text-fg-muted">
              {t(`roles.${system.role}`)} · {t(`statuses.${system.status}`)}
            </span>
          </>
        }
      />
      <ProfileSection system={system} canManage={canManage} />
      <ClassificationSection system={system} canManage={canManage} timeZone={timeZone} />
      <ObligationsSection
        system={system}
        canManage={canManage}
        timeZone={timeZone}
        onSaved={setSystem}
      />
      {canReadRisks ? (
        <RiskLinksSection
          system={system}
          canLink={canManage}
          options={riskOptions}
          timeZone={timeZone}
          onChanged={setSystem}
        />
      ) : null}
    </div>
  );
}
