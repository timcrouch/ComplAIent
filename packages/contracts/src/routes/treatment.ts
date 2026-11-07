import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text, textOrEmpty } from "../text.js";
import { MyTaskDto } from "./evidence.js";
import { TreatmentActionDto } from "./risk-dtos.js";

export const AddTreatmentActionInput = z
  .object({
    title: text(200),
    description: textOrEmpty(2000, "multiline"),
    assigneeId: z.uuid(),
    dueDate: z.iso.date(),
    /** A control accepted on the risk, or null. */
    controlId: z.uuid().nullable(),
  })
  .strict()
  .openapi("AddTreatmentActionInput");
export type AddTreatmentActionInput = z.infer<typeof AddTreatmentActionInput>;

export const CompleteTaskInput = z
  .object({ note: textOrEmpty(2000, "multiline") })
  .strict()
  .openapi("CompleteTaskInput");
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

export const CancelTaskInput = z
  .object({ reason: text(2000, "multiline") })
  .strict()
  .openapi("CancelTaskInput");
export type CancelTaskInput = z.infer<typeof CancelTaskInput>;

const idParams = z.object({ id: z.uuid() });

/** 404: not visible to the caller. 409: `details[].path` names the `ConflictReason`. */
export const treatmentRoutes = {
  addAction: defineRoute({
    method: "post",
    path: "/api/v1/risks/{id}/actions",
    summary:
      "Add a treatment action to a risk; 409 riskClosed or treatmentIsAccept when none can be planned",
    permission: "risks.review",
    request: { params: idParams, body: AddTreatmentActionInput },
    responses: { 201: TreatmentActionDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  complete: defineRoute({
    method: "post",
    path: "/api/v1/tasks/{id}/complete",
    summary:
      "Complete a treatment action or review task: the assignee or a reviewer; evidence requests complete by upload",
    permission: "me.read",
    request: { params: idParams, body: CompleteTaskInput },
    responses: { 200: MyTaskDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
  cancel: defineRoute({
    method: "post",
    path: "/api/v1/tasks/{id}/cancel",
    summary: "Cancel an open treatment action, with a reason",
    permission: "risks.review",
    request: { params: idParams, body: CancelTaskInput },
    responses: { 200: TreatmentActionDto, 404: ErrorResponse, 409: ErrorResponse },
  }),
};
