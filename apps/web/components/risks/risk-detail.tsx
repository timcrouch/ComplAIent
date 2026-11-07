"use client";

import type { PersonRef, RiskDetailDto, RiskScaleDto } from "@isms/contracts";
import { EvidenceSection } from "../evidence/evidence-section";
import { ApprovalSection } from "./approval-section";
import { AssessmentSection } from "./assessment-section";
import { ControlsSection } from "./controls-section";
import { HistorySection } from "./history-section";
import { LifecycleSection } from "./lifecycle-section";
import { RecordSection, type OwnerCandidate, type Unit } from "./record-section";
import { RiskJourneyPanel } from "./risk-journey-panel";
import { RiskHeader } from "./risk-header";
import { RiskProvider } from "./risk-context";
import { ToConfirmSection } from "./to-confirm-section";
import { TreatmentSection } from "./treatment-section";

export type RiskDetailProps = {
  initial: RiskDetailDto;
  scale: RiskScaleDto;
  sites: readonly Unit[];
  departments: readonly Unit[];
  /** Null when the viewer may not list people (the owner is then shown, not edited). */
  owners: readonly OwnerCandidate[] | null;
  canSearchLibrary: boolean;
  timeZone: string;
  /** People who can be asked for evidence; null (or absent) when the viewer may not list people. */
  people?: readonly PersonRef[] | null;
  /** The evidence size limit, checked in the browser before an upload starts. */
  evidenceMaxBytes: number;
};

/**
 * A risk for review: the record, to-confirm items, assessment, controls, treatment, evidence,
 * approval and history. Every section edits through the shared risk, so each change sends the
 * version on screen.
 */
export function RiskDetail(props: RiskDetailProps) {
  const { initial, scale, sites, departments, owners, canSearchLibrary, timeZone } = props;
  const { people = null, evidenceMaxBytes } = props;
  return (
    <RiskProvider initial={initial} timeZone={timeZone}>
      <div className="flex flex-col gap-6">
        <RiskHeader />
        <RiskJourneyPanel />
        <RecordSection sites={sites} departments={departments} owners={owners} />
        <ToConfirmSection />
        <AssessmentSection scale={scale} />
        <ControlsSection canSearchLibrary={canSearchLibrary} />
        <TreatmentSection scale={scale} people={people} />
        <EvidenceSection people={people} maxBytes={evidenceMaxBytes} />
        <ApprovalSection />
        <LifecycleSection />
        <HistorySection />
      </div>
    </RiskProvider>
  );
}
