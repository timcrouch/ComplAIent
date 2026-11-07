import { CONTROL_CODE_PATTERN } from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text, textOrEmpty } from "../text.js";
import { PersonRef } from "./risk-dtos.js";
import { RiskStateSchema } from "./risks.js";

export const ControlTestResultSchema = z
  .enum(["effective", "partially_effective", "ineffective"])
  .openapi("ControlTestResult");
export type ControlTestResult = z.infer<typeof ControlTestResultSchema>;

export const ControlTestDto = z
  .object({
    id: z.string(),
    testedOn: z.iso.date(),
    result: ControlTestResultSchema,
    method: z.string(),
    notes: z.string(),
    testedBy: PersonRef,
    /** Evidence on risks the reader may see. */
    evidence: z.array(z.object({ id: z.string(), fileName: z.string() })),
    /** Evidence attached to the test that the reader may not see. */
    hiddenEvidenceCount: z.number().int().nonnegative(),
  })
  .openapi("ControlTestDto");
export type ControlTestDto = z.infer<typeof ControlTestDto>;

/** A control in operation: where it is used, and how it has been tested. */
export const ControlOperationDto = z
  .object({
    code: z.string(),
    /** Risks the viewer may see where the control is accepted. */
    risks: z.array(
      z.object({
        id: z.string(),
        reference: z.string(),
        title: z.string(),
        state: RiskStateSchema,
      }),
    ),
    /** Evidence on those risks linked to the control. */
    evidenceCount: z.number().int().min(0),
    /** Newest first, at most 50. */
    tests: z.array(ControlTestDto),
    latest: ControlTestDto.nullable(),
    /** Never tested, or the latest test is older than the organisation's review interval. */
    testDue: z.boolean(),
    canRecordTest: z.boolean(),
    /** The AI can suggest test steps (control_test_steps is ready) and the viewer can record tests. */
    canSuggestSteps: z.boolean(),
    /** Visible evidence linked to this control, to attach to a test. */
    evidenceOptions: z.array(
      z.object({ id: z.string(), fileName: z.string(), riskReference: z.string() }),
    ),
  })
  .openapi("ControlOperationDto");
export type ControlOperationDto = z.infer<typeof ControlOperationDto>;

export const RecordControlTestInput = z
  .object({
    /** Not in the future (checked by the API against today, UTC). */
    testedOn: z.iso.date(),
    result: ControlTestResultSchema,
    method: text(4000, "multiline"),
    notes: textOrEmpty(2000, "multiline"),
    evidenceIds: z.array(z.uuid()).max(20),
  })
  .strict()
  .openapi("RecordControlTestInput");
export type RecordControlTestInput = z.infer<typeof RecordControlTestInput>;

/** AI-suggested steps for testing a control, from the library text only; nothing is stored. */
export const ControlTestStepsResponse = z
  .object({ steps: z.array(z.string()).min(3).max(7), interactionId: z.string() })
  .openapi("ControlTestStepsResponse");
export type ControlTestStepsResponse = z.infer<typeof ControlTestStepsResponse>;

const codeParams = z.object({ code: z.string().regex(CONTROL_CODE_PATTERN) });

/** 404: no such control. 400: `details[].path` names the field (`evidenceIds.<i>`, `testedOn`). */
export const controlOperationRoutes = {
  operation: defineRoute({
    method: "get",
    path: "/api/v1/library/controls/{code}/operation",
    summary: "A control in operation: the risks using it, its evidence and its test history",
    permission: "library.read",
    request: { params: codeParams },
    responses: { 200: ControlOperationDto, 404: ErrorResponse },
  }),
  recordTest: defineRoute({
    method: "post",
    path: "/api/v1/library/controls/{code}/tests",
    summary: "Record a test of a control, with the evidence it used",
    permission: "controls.test",
    request: { params: codeParams, body: RecordControlTestInput },
    responses: { 201: ControlTestDto, 400: ErrorResponse, 404: ErrorResponse },
  }),
  suggestTestSteps: defineRoute({
    method: "post",
    path: "/api/v1/library/controls/{code}/test-steps",
    summary: "Ask the AI to suggest steps for testing a control; 409 aiUnavailable.<reason>",
    permission: "controls.test",
    request: { params: codeParams },
    responses: { 200: ControlTestStepsResponse, 404: ErrorResponse, 409: ErrorResponse },
  }),
};
