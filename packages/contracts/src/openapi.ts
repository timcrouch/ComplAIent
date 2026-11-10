import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ZodType } from "zod";
import { ConflictReasonSchema } from "./conflicts.js";
import { ErrorResponse } from "./errors.js";
import type { RouteDef } from "./route.js";
import { aiActRoutes } from "./routes/ai-act.js";
import { aiSettingsRoutes } from "./routes/ai-settings.js";
import { concernRoutes } from "./routes/concerns.js";
import { concernRewardRoutes } from "./routes/concern-rewards.js";
import { controlOperationRoutes } from "./routes/control-operation.js";
import { demoRoutes } from "./routes/demo.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { identityRoutes } from "./routes/identity.js";
import { libraryRoutes } from "./routes/library.js";
import { organisationRoutes } from "./routes/organisation.js";
import { peopleRoutes } from "./routes/people.js";
import { riskInsightRoutes } from "./routes/risk-insights.js";
import { riskLifecycleRoutes } from "./routes/risk-lifecycle.js";
import { reportRoutes } from "./routes/reports.js";
import { riskRoutes } from "./routes/risks.js";
import { systemRoutes } from "./routes/system.js";
import { treatmentRoutes } from "./routes/treatment.js";
import { workspaceRoutes } from "./routes/workspace.js";

export const allRoutes: RouteDef[] = [
  systemRoutes.health,
  systemRoutes.ready,
  identityRoutes.me,
  identityRoutes.updatePreferences,
  peopleRoutes.listUsers,
  peopleRoutes.grantRole,
  peopleRoutes.revokeRole,
  libraryRoutes.listFrameworks,
  libraryRoutes.listControls,
  libraryRoutes.getControl,
  libraryRoutes.reviewMapping,
  libraryRoutes.exportLibrary,
  controlOperationRoutes.operation,
  controlOperationRoutes.recordTest,
  controlOperationRoutes.suggestTestSteps,
  organisationRoutes.get,
  organisationRoutes.updateProfile,
  organisationRoutes.replaceUnits,
  organisationRoutes.setFrameworks,
  organisationRoutes.suggestFrameworks,
  organisationRoutes.setRiskScale,
  organisationRoutes.setReviewInterval,
  organisationRoutes.setConcernRewards,
  organisationRoutes.resumeConcernRewards,
  organisationRoutes.setModule,
  organisationRoutes.completeSetup,
  riskRoutes.report,
  riskRoutes.list,
  riskInsightRoutes.map,
  riskRoutes.get,
  riskRoutes.update,
  riskRoutes.requestSuggestions,
  riskRoutes.decideControl,
  riskRoutes.addControl,
  riskRoutes.removeControl,
  riskRoutes.submit,
  riskRoutes.approve,
  riskRoutes.return,
  riskLifecycleRoutes.close,
  riskLifecycleRoutes.reassess,
  riskLifecycleRoutes.confirmReview,
  treatmentRoutes.addAction,
  treatmentRoutes.complete,
  treatmentRoutes.cancel,
  riskRoutes.myConcerns,
  aiSettingsRoutes.get,
  aiSettingsRoutes.setKey,
  aiSettingsRoutes.removeKey,
  aiSettingsRoutes.update,
  aiSettingsRoutes.listModels,
  aiSettingsRoutes.test,
  concernRoutes.aiStatus,
  concernRoutes.start,
  concernRoutes.reply,
  concernRoutes.get,
  concernRoutes.submit,
  concernRoutes.abandon,
  concernRoutes.transcript,
  concernRewardRoutes.contribution,
  concernRewardRoutes.queue,
  concernRewardRoutes.get,
  concernRewardRoutes.judge,
  evidenceRoutes.upload,
  evidenceRoutes.download,
  evidenceRoutes.requestEvidence,
  evidenceRoutes.myTasks,
  evidenceRoutes.uploadForTask,
  workspaceRoutes.get,
  reportRoutes.register,
  reportRoutes.soa,
  reportRoutes.setApplicability,
  reportRoutes.board,
  reportRoutes.narrativeDraft,
  reportRoutes.approveNarrative,
  reportRoutes.registerXlsx,
  reportRoutes.registerPdf,
  reportRoutes.soaXlsx,
  reportRoutes.soaPdf,
  reportRoutes.boardPdf,
  aiActRoutes.listSystems,
  aiActRoutes.createSystem,
  aiActRoutes.getSystem,
  aiActRoutes.updateSystem,
  aiActRoutes.classify,
  aiActRoutes.draftClassification,
  aiActRoutes.updateObligation,
  aiActRoutes.obligationGuidance,
  aiActRoutes.linkRisk,
  aiActRoutes.unlinkRisk,
];

/**
 * Routes only some instances register (`RouteDef.conditional`), kept out of `allRoutes` so the
 * API's own document shows only what it serves. The contract snapshot documents both lists.
 */
export const conditionalRoutes: RouteDef[] = [
  demoRoutes.status,
  demoRoutes.loadSample,
  demoRoutes.reset,
];

const CONDITION_SETTING: Record<NonNullable<RouteDef["conditional"]>, string> = {
  demo: "DEMO_TOOLS_ENABLED",
};

/** Probes: no authentication and no throttling (the API's AuthGuard and throttler agree). */
const PUBLIC_PATHS = new Set<string>([systemRoutes.health.path, systemRoutes.ready.path]);

const errorBody = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});

/** 409s carry a machine reason the web maps to its own copy (P2-R8). */
const CONFLICT_DESCRIPTION = "CONFLICT: details[].path is a ConflictReason, or `<reason>.<item>`";

const OCTET_STREAM = "application/octet-stream";

function describeResponse(schema: ZodType, status: string, file: boolean) {
  if (status === "204") return { description: "No content" };
  const description = status === "409" ? CONFLICT_DESCRIPTION : `Response ${status}`;
  const type = file && status === "200" ? OCTET_STREAM : "application/json";
  return { description, content: { [type]: { schema } } };
}

export function buildOpenApiDocument(routes: RouteDef[]) {
  const registry = new OpenAPIRegistry();
  registry.register("ConflictReason", ConflictReasonSchema);

  for (const route of routes) {
    const responses: RouteConfig["responses"] = {};
    for (const [status, schema] of Object.entries(route.responses)) {
      responses[status] = describeResponse(schema, status, route.download === true);
    }
    const auto: Record<string, string> = PUBLIC_PATHS.has(route.path)
      ? { "500": "Internal error" }
      : {
          "400": "Validation failed",
          "401": "Unauthenticated",
          "403": route.recentAuth
            ? "Forbidden, or RECENT_AUTH_REQUIRED when a recent re-authentication is needed"
            : "Forbidden",
          "429": "RATE_LIMITED: too many requests for this caller",
          "500": "Internal error",
          "503": "AUTH_UNAVAILABLE: the identity provider's signing keys cannot be obtained",
        };
    if (route.request?.body) auto["413"] = "PAYLOAD_TOO_LARGE: the JSON body exceeds 1 MB";
    if (route.conditional)
      auto["404"] =
        `NOT_FOUND: the route exists only when ${CONDITION_SETTING[route.conditional]}=true`;
    if (route.module)
      auto["404"] = `NOT_FOUND: the route exists only while the ${route.module} module is on`;
    if (route.upload)
      auto["413"] = `PAYLOAD_TOO_LARGE: the file exceeds ${route.upload.maxBytesConfig}`;
    for (const [status, description] of Object.entries(auto)) {
      responses[status] ??= errorBody(description);
    }

    const request: NonNullable<RouteConfig["request"]> = {};
    if (route.request?.params) request.params = route.request.params;
    if (route.request?.query) request.query = route.request.query;
    if (route.request?.body) {
      request.body = {
        content: { "application/json": { schema: route.request.body } },
      };
    }
    if (route.upload) {
      request.body = {
        required: true,
        content: {
          [OCTET_STREAM]: { schema: { type: "string", format: "binary" } },
        },
      };
    }

    registry.registerPath({
      method: route.method,
      path: route.path,
      summary: route.summary,
      ...(route.permission ? { "x-permission": route.permission } : {}),
      ...(route.recentAuth ? { "x-recent-auth": true } : {}),
      ...(route.conditional ? { "x-conditional": route.conditional } : {}),
      ...(route.module ? { "x-module": route.module } : {}),
      request,
      responses,
    });
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "ISMS API", version: "1" },
  });
}
