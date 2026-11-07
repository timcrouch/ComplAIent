"use server";

import {
  AddControlInput,
  AddTreatmentActionInput,
  ApproveRiskInput,
  CancelTaskInput,
  CloseRiskInput,
  CompleteTaskInput,
  ConfirmReviewInput,
  ControlListQuery,
  DecideControlInput,
  EvidenceRequestInput,
  ReassessRiskInput,
  RemoveControlInput,
  RequestControlSuggestionsInput,
  ReturnRiskInput,
  RiskEditInput,
  RiskListQuery,
  SubmitRiskInput,
  evidenceRoutes,
  libraryRoutes,
  riskLifecycleRoutes,
  riskRoutes,
  treatmentRoutes,
  type ControlListResponse,
  type MyTaskDto,
  type RiskChanges,
  type RiskDetailDto,
  type RiskListFilter,
  type RiskListResponse,
  type TreatmentActionDto,
} from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const RISKS = "/risks";
const Uuid = z.uuid();

/** An id that is not a UUID names nothing the viewer can see. */
const notFound: CallResult<never> = { ok: false, kind: "not-found", details: [] };

const riskPage = (id: string) => ({ returnTo: `${RISKS}/${id}` });

/** Every change to a risk refreshes the queue and the risk's own pages. */
const changed = (result: CallResult<RiskDetailDto>) => revalidated(result, RISKS);

/** A map cell the list is narrowed to. */
export type RiskListCell = {
  likelihood: number;
  impact: number;
  basis: "inherent" | "residual";
  /** Closed risks are left out of a cell unless this is set (P6-R3). */
  includeClosed?: boolean;
};

/** One page of the queue for a filter, after `cursor` (the previous page's `nextCursor`). */
export async function listRisks(
  filter: RiskListFilter,
  cursor: string | undefined,
  cell?: RiskListCell,
): Promise<CallResult<RiskListResponse>> {
  // `includeClosed` is the strings "true" / "false" on the wire, never a boolean.
  const parsed = RiskListQuery.safeParse({
    filter,
    cursor,
    ...(cell
      ? {
          likelihood: cell.likelihood,
          impact: cell.impact,
          basis: cell.basis,
          ...(cell.includeClosed ? { includeClosed: "true" } : {}),
        }
      : {}),
  });
  if (!parsed.success) return invalid(parsed.error);
  const query = {
    filter: parsed.data.filter,
    ...(cursor ? { cursor } : {}),
    ...(cell
      ? {
          likelihood: cell.likelihood,
          impact: cell.impact,
          basis: cell.basis,
          ...(cell.includeClosed ? { includeClosed: "true" as const } : {}),
        }
      : {}),
  };
  return callApi(riskRoutes.list, { query }, { returnTo: RISKS });
}

/** The risk as stored now (after a stale save, or while suggestions are being found). */
export async function getRisk(id: string): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  return callApi(riskRoutes.get, { params: { id } }, riskPage(id));
}

/** An ordinary, versioned edit by a person; 409 `staleVersion` when someone wrote first. */
export async function updateRisk(
  id: string,
  expectedVersion: number,
  changes: RiskChanges,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = RiskEditInput.safeParse({ expectedVersion, changes });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskRoutes.update, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Queues the AI's control suggestions; 409 `aiUnavailable.<reason>` when it cannot run. */
export async function requestControlSuggestions(
  id: string,
  expectedVersion: number,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = RequestControlSuggestionsInput.safeParse({ expectedVersion });
  if (!parsed.success) return invalid(parsed.error);
  return callApi(
    riskRoutes.requestSuggestions,
    { params: { id }, body: parsed.data },
    riskPage(id),
  );
}

/** Accepts or rejects one suggested control; a blank reason is left out. */
export async function decideControl(
  id: string,
  riskControlId: string,
  expectedVersion: number,
  decision: "accept" | "reject",
  reason: string | undefined,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success || !Uuid.safeParse(riskControlId).success) return notFound;
  const trimmed = reason?.trim();
  const parsed = DecideControlInput.safeParse({
    expectedVersion,
    decision,
    ...(trimmed ? { reason: trimmed } : {}),
  });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(
      riskRoutes.decideControl,
      { params: { id, riskControlId }, body: parsed.data },
      riskPage(id),
    ),
  );
}

/** Adds a library control by code; it is accepted at once. */
export async function addControl(
  id: string,
  expectedVersion: number,
  controlCode: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = AddControlInput.safeParse({ expectedVersion, controlCode });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskRoutes.addControl, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Removes an accepted control that has no evidence. */
export async function removeControl(
  id: string,
  riskControlId: string,
  expectedVersion: number,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success || !Uuid.safeParse(riskControlId).success) return notFound;
  const parsed = RemoveControlInput.safeParse({ expectedVersion });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(
      riskRoutes.removeControl,
      { params: { id, riskControlId }, body: parsed.data },
      riskPage(id),
    ),
  );
}

/** Searches the control library (Plan 2) for the picker. */
export async function searchControls(q: string): Promise<CallResult<ControlListResponse>> {
  const parsed = ControlListQuery.safeParse({ q });
  if (!parsed.success) return invalid(parsed.error);
  const query = parsed.data.q ? { q: parsed.data.q } : {};
  return callApi(libraryRoutes.listControls, { query }, { returnTo: RISKS });
}

/** Submits the risk for approval; 409 `submitBlocked.<blocker>` names each thing missing. */
export async function submitRisk(
  id: string,
  expectedVersion: number,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = SubmitRiskInput.safeParse({ expectedVersion });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskRoutes.submit, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Approves the submitted version; a blank comment is left out. */
export async function approveRisk(
  id: string,
  expectedVersion: number,
  comment: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const trimmed = comment.trim();
  const parsed = ApproveRiskInput.safeParse({
    expectedVersion,
    ...(trimmed ? { comment: trimmed } : {}),
  });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskRoutes.approve, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Returns the submitted risk with a (required) comment; it becomes editable again. */
export async function returnRisk(
  id: string,
  expectedVersion: number,
  comment: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = ReturnRiskInput.safeParse({ expectedVersion, comment });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskRoutes.return, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Asks a person for evidence of an accepted control; it becomes a task for them. */
export async function requestEvidence(
  id: string,
  input: EvidenceRequestInput,
): Promise<CallResult<MyTaskDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = EvidenceRequestInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return callApi(
    evidenceRoutes.requestEvidence,
    { params: { id }, body: parsed.data },
    riskPage(id),
  );
}

/** Marks an approved risk as treated; 409 `openTreatmentActions` while actions are open. */
export async function closeRisk(
  id: string,
  expectedVersion: number,
  note: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = CloseRiskInput.safeParse({ expectedVersion, note: note.trim() });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(riskLifecycleRoutes.close, { params: { id }, body: parsed.data }, riskPage(id)),
  );
}

/** Reopens an approved or treated risk; it becomes proposed again. */
export async function reassessRisk(
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = ReassessRiskInput.safeParse({ expectedVersion, reason: reason.trim() });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(
      riskLifecycleRoutes.reassess,
      { params: { id }, body: parsed.data },
      riskPage(id),
    ),
  );
}

/** Confirms the risk is still accurate; the next review moves on. The note may be empty. */
export async function confirmReview(
  id: string,
  expectedVersion: number,
  note: string,
): Promise<CallResult<RiskDetailDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = ConfirmReviewInput.safeParse({ expectedVersion, note: note.trim() });
  if (!parsed.success) return invalid(parsed.error);
  return changed(
    await callApi(
      riskLifecycleRoutes.confirmReview,
      { params: { id }, body: parsed.data },
      riskPage(id),
    ),
  );
}

/** Adds a treatment action; it becomes a task for the assignee. */
export async function addTreatmentAction(
  id: string,
  input: AddTreatmentActionInput,
): Promise<CallResult<TreatmentActionDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = AddTreatmentActionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(treatmentRoutes.addAction, { params: { id }, body: parsed.data }, riskPage(id)),
    RISKS,
  );
}

const TASKS = "/tasks";

/** Completes an action or review task, with an optional note. */
export async function completeTask(id: string, note: string): Promise<CallResult<MyTaskDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = CompleteTaskInput.safeParse({ note: note.trim() });
  if (!parsed.success) return invalid(parsed.error);
  const result = await callApi(
    treatmentRoutes.complete,
    { params: { id }, body: parsed.data },
    { returnTo: TASKS },
  );
  return revalidated(revalidated(result, TASKS), RISKS);
}

/** Cancels an open treatment action, with a reason. */
export async function cancelTask(
  id: string,
  reason: string,
): Promise<CallResult<TreatmentActionDto>> {
  if (!Uuid.safeParse(id).success) return notFound;
  const parsed = CancelTaskInput.safeParse({ reason: reason.trim() });
  if (!parsed.success) return invalid(parsed.error);
  const result = await callApi(
    treatmentRoutes.cancel,
    { params: { id }, body: parsed.data },
    { returnTo: TASKS },
  );
  return revalidated(revalidated(result, TASKS), RISKS);
}
