import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";

/** Demo mode is on (the route exists only then), and what the confirmation must be. */
export const DemoStatusResponse = z
  .object({
    enabled: z.literal(true),
    /** The text to type is this name, or `RESET` when no organisation is set up yet. */
    organisationName: z.string().nullable(),
  })
  .openapi("DemoStatusResponse");
export type DemoStatusResponse = z.infer<typeof DemoStatusResponse>;

/**
 * The typed confirmation, as typed. The server trims it and compares case-sensitively with
 * the organisation name, or `RESET` when there is none (400 `confirmationMismatch`).
 */
export const DemoConfirmInput = z
  .object({ confirm: z.string().max(300) })
  .strict()
  .openapi("DemoConfirmInput");
export type DemoConfirmInput = z.infer<typeof DemoConfirmInput>;

export const DemoLoadResponse = z
  .object({
    risks: z.number().int().min(0),
    people: z.number().int().min(0),
    /** How long the load took. */
    ms: z.number().int().min(0),
    /** Evidence files that could not be stored; their downloads 404. */
    evidenceFailed: z.number().int().min(0),
  })
  .openapi("DemoLoadResponse");
export type DemoLoadResponse = z.infer<typeof DemoLoadResponse>;

/**
 * Demo and training tools (spec §5.1). Registered only when DEMO_TOOLS_ENABLED is true; with
 * it off every path is 404. Afterwards every session is gone, the caller's included.
 */
export const demoRoutes = {
  status: defineRoute({
    method: "get",
    path: "/api/v1/demo",
    summary: "Demo mode is on; the organisation name the confirmation must match",
    permission: "organisation.manage",
    conditional: "demo",
    responses: { 200: DemoStatusResponse },
  }),
  loadSample: defineRoute({
    method: "post",
    path: "/api/v1/demo/sample",
    summary:
      "Reset, then load a year of sample activity for Isarwerk Finanz AG (sample); 400 confirmationMismatch unless confirm (trimmed) is the organisation name, or RESET; audited as demo.reset and demo.sample_loaded",
    permission: "organisation.manage",
    recentAuth: true,
    conditional: "demo",
    request: { body: DemoConfirmInput },
    responses: { 200: DemoLoadResponse, 400: ErrorResponse },
  }),
  reset: defineRoute({
    method: "post",
    path: "/api/v1/demo/reset",
    summary:
      "Delete all data, settings, evidence files and sessions, back to a fresh install; 400 confirmationMismatch unless confirm (trimmed) is the organisation name, or RESET; audited as demo.reset",
    permission: "organisation.manage",
    recentAuth: true,
    conditional: "demo",
    request: { body: DemoConfirmInput },
    responses: { 204: z.void(), 400: ErrorResponse },
  }),
};
