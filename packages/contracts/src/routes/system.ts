import { z } from "zod";
import "../zod.js";
import { defineRoute } from "../route.js";

export const HealthResponse = z.object({ status: z.literal("ok") }).openapi("HealthResponse");
export const ReadyResponse = z
  .object({
    status: z.enum(["ok", "fail"]),
    checks: z.record(z.string(), z.enum(["ok", "fail"])),
  })
  .openapi("ReadyResponse");

export const systemRoutes = {
  health: defineRoute({
    method: "get",
    path: "/api/v1/health",
    summary: "Liveness probe",
    responses: { 200: HealthResponse },
  }),
  ready: defineRoute({
    method: "get",
    path: "/api/v1/ready",
    summary: "Readiness probe",
    responses: { 200: ReadyResponse, 503: ReadyResponse },
  }),
};
