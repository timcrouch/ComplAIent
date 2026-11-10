import {
  MAX_APPETITE_THRESHOLD,
  MAX_REVIEW_INTERVAL_MONTHS,
  MIN_APPETITE_THRESHOLD,
  MIN_REVIEW_INTERVAL_MONTHS,
  isCountryCode,
} from "@isms/domain";
import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { ModuleKeySchema } from "../modules.js";
import { defineRoute } from "../route.js";
import { text } from "../text.js";

export const SetupStepSchema = z
  .enum(["profile", "sites", "frameworks", "riskScale"])
  .openapi("SetupStep");
export type SetupStep = z.infer<typeof SetupStepSchema>;

const PersonRef = z.object({ id: z.string(), displayName: z.string() });

export const SiteDto = z
  .object({ id: z.string(), name: z.string(), countryCode: z.string() })
  .openapi("SiteDto");
export type SiteDto = z.infer<typeof SiteDto>;

export const DepartmentDto = z
  .object({ id: z.string(), name: z.string() })
  .openapi("DepartmentDto");
export type DepartmentDto = z.infer<typeof DepartmentDto>;

export const OrganisationFrameworkDto = z
  .object({
    id: z.string(),
    frameworkVersionId: z.string(),
    frameworkVersionKey: z.string(),
    name: z.string(),
    versionLabel: z.string(),
    status: z.enum(["suggested", "confirmed"]),
    source: z.enum(["manual", "ai"]),
    reasoning: z.string().nullable(),
    confirmedBy: PersonRef.nullable(),
    confirmedAt: z.iso.datetime().nullable(),
  })
  .openapi("OrganisationFrameworkDto");
export type OrganisationFrameworkDto = z.infer<typeof OrganisationFrameworkDto>;

export const RiskLevelDto = z
  .object({
    value: z.number().int().min(1).max(5),
    label: z.string(),
    description: z.string(),
  })
  .openapi("RiskLevelDto");
export type RiskLevelDto = z.infer<typeof RiskLevelDto>;

/** `version` is null for the default scale an installation has not adopted yet. */
export const RiskScaleDto = z
  .object({
    version: z.number().int().nullable(),
    appetiteThreshold: z.number().int(),
    likelihood: z.array(RiskLevelDto),
    impact: z.array(RiskLevelDto),
  })
  .openapi("RiskScaleDto");
export type RiskScaleDto = z.infer<typeof RiskScaleDto>;

export const OrganisationProfileDto = z
  .object({
    name: z.string(),
    description: z.string(),
    approximateHeadcount: z.number().int().nullable(),
  })
  .openapi("OrganisationProfileDto");
export type OrganisationProfileDto = z.infer<typeof OrganisationProfileDto>;

export const OrganisationResponse = z
  .object({
    profile: OrganisationProfileDto.nullable(),
    sites: z.array(SiteDto),
    departments: z.array(DepartmentDto),
    frameworks: z.array(OrganisationFrameworkDto),
    riskScale: RiskScaleDto.nullable(),
    defaultRiskScale: RiskScaleDto,
    /** Months between periodic reviews of an approved or closed risk (1 to 36, default 12). */
    reviewIntervalMonths: z.number().int(),
    /** Concern reporting continues normally when rewards are disabled. */
    concernRewards: z.object({ enabled: z.boolean() }),
    setup: z.object({
      completedAt: z.iso.datetime().nullable(),
      /** Steps still to do, in setup order. */
      missing: z.array(SetupStepSchema),
    }),
    /** The optional modules switched on, in key order. Never a setup step. */
    modules: z.array(ModuleKeySchema),
  })
  .openapi("OrganisationResponse");
export type OrganisationResponse = z.infer<typeof OrganisationResponse>;

export const ConcernRewardsSettingsInput = z
  .object({ enabled: z.boolean() })
  .strict()
  .openapi("ConcernRewardsSettingsInput");
export type ConcernRewardsSettingsInput = z.infer<typeof ConcernRewardsSettingsInput>;

export const ConcernRewardsSettingsDto = z
  .object({ enabled: z.boolean() })
  .openapi("ConcernRewardsSettingsDto");
export type ConcernRewardsSettingsDto = z.infer<typeof ConcernRewardsSettingsDto>;

export const ResumeConcernRewardsResponse = z
  .object({ queued: z.number().int().nonnegative() })
  .openapi("ResumeConcernRewardsResponse");
export type ResumeConcernRewardsResponse = z.infer<typeof ResumeConcernRewardsResponse>;

export const ProfileInput = z
  .object({
    name: text(200),
    description: text(2000, "multiline"),
    approximateHeadcount: z.number().int().min(1).max(1_000_000),
  })
  .strict()
  .openapi("ProfileInput");
export type ProfileInput = z.infer<typeof ProfileInput>;

const unitName = text(120, "name");

/**
 * Names within one list must differ ignoring case (names are already trimmed). Reports each
 * repeat at `<i>.name`. The API re-checks with the database's own `lower()`.
 */
function uniqueNames(units: readonly { name: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  units.forEach((unit, i) => {
    const key = unit.name.toLowerCase();
    if (seen.has(key))
      ctx.addIssue({
        code: "custom",
        path: [i, "name"],
        message: "Duplicate name",
      });
    seen.add(key);
  });
}

export const SiteInput = z
  .object({
    /** Omit to add a site; give a stored id to keep (and possibly rename) that site. */
    id: z.uuid().optional(),
    name: unitName,
    countryCode: z.string().trim().refine(isCountryCode, {
      message: "Not an ISO 3166-1 alpha-2 country code",
    }),
  })
  .strict()
  .openapi("SiteInput");
export type SiteInput = z.infer<typeof SiteInput>;

export const DepartmentInput = z
  .object({ id: z.uuid().optional(), name: unitName })
  .strict()
  .openapi("DepartmentInput");
export type DepartmentInput = z.infer<typeof DepartmentInput>;

/** The complete lists of sites and departments; anything stored but not listed is removed. */
export const UnitsInput = z
  .object({
    sites: z.array(SiteInput).min(1).max(200).superRefine(uniqueNames),
    departments: z.array(DepartmentInput).max(200).superRefine(uniqueNames),
  })
  .strict()
  .openapi("UnitsInput");
export type UnitsInput = z.infer<typeof UnitsInput>;

export const UnitsResponse = z
  .object({ sites: z.array(SiteDto), departments: z.array(DepartmentDto) })
  .openapi("UnitsResponse");
export type UnitsResponse = z.infer<typeof UnitsResponse>;

export const FrameworksInput = z
  .object({
    frameworkVersionIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .superRefine((ids, ctx) => {
        ids.forEach((id, i) => {
          if (ids.indexOf(id) !== i)
            ctx.addIssue({ code: "custom", path: [i], message: "Duplicate" });
        });
      }),
  })
  .strict()
  .openapi("FrameworksInput");
export type FrameworksInput = z.infer<typeof FrameworksInput>;

export const FrameworksResponse = z
  .object({ frameworks: z.array(OrganisationFrameworkDto) })
  .openapi("FrameworksResponse");
export type FrameworksResponse = z.infer<typeof FrameworksResponse>;

export const RiskScaleInput = z
  .object({
    appetiteThreshold: z.number().int().min(MIN_APPETITE_THRESHOLD).max(MAX_APPETITE_THRESHOLD),
  })
  .strict()
  .openapi("RiskScaleInput");
export type RiskScaleInput = z.infer<typeof RiskScaleInput>;

export const ReviewIntervalInput = z
  .object({
    months: z.number().int().min(MIN_REVIEW_INTERVAL_MONTHS).max(MAX_REVIEW_INTERVAL_MONTHS),
  })
  .strict()
  .openapi("ReviewIntervalInput");
export type ReviewIntervalInput = z.infer<typeof ReviewIntervalInput>;

export const SetModuleInput = z.object({ enabled: z.boolean() }).strict().openapi("SetModuleInput");
export type SetModuleInput = z.infer<typeof SetModuleInput>;

export const ModulesResponse = z
  .object({ modules: z.array(ModuleKeySchema) })
  .openapi("ModulesResponse");
export type ModulesResponse = z.infer<typeof ModulesResponse>;

export const CompleteSetupResponse = z
  .object({ completedAt: z.iso.datetime() })
  .openapi("CompleteSetupResponse");
export type CompleteSetupResponse = z.infer<typeof CompleteSetupResponse>;

/** 409: `details[].path` names the `ConflictReason` and the unit or setup step. */
export const organisationRoutes = {
  get: defineRoute({
    method: "get",
    path: "/api/v1/organisation",
    summary: "The organisation's setup: profile, sites, departments, frameworks and risk scale",
    permission: "organisation.read",
    responses: { 200: OrganisationResponse },
  }),
  updateProfile: defineRoute({
    method: "put",
    path: "/api/v1/organisation/profile",
    summary: "Save the organisation's name, description and approximate headcount",
    permission: "organisation.manage",
    request: { body: ProfileInput },
    responses: { 200: OrganisationResponse },
  }),
  replaceUnits: defineRoute({
    method: "put",
    path: "/api/v1/organisation/units",
    summary:
      "Replace the sites and departments together; a unit still in use cannot be removed and nothing changes",
    permission: "organisation.manage",
    request: { body: UnitsInput },
    responses: { 200: UnitsResponse, 409: ErrorResponse },
  }),
  setFrameworks: defineRoute({
    method: "put",
    path: "/api/v1/organisation/frameworks",
    summary:
      "Confirm the frameworks the organisation follows; unchosen confirmed ones are removed and unchosen suggestions dismissed",
    permission: "organisation.manage",
    request: { body: FrameworksInput },
    responses: { 200: FrameworksResponse },
  }),
  suggestFrameworks: defineRoute({
    method: "post",
    path: "/api/v1/organisation/frameworks/suggestions",
    summary:
      "Ask the AI which frameworks apply; adds them as suggestions with reasoning, never changing a confirmed one",
    permission: "organisation.manage",
    responses: { 200: FrameworksResponse, 409: ErrorResponse },
  }),
  setRiskScale: defineRoute({
    method: "put",
    path: "/api/v1/organisation/risk-scale",
    summary: "Set the risk appetite; a new value creates a new, immutable risk scale version",
    permission: "organisation.manage",
    request: { body: RiskScaleInput },
    responses: { 200: RiskScaleDto },
  }),
  setReviewInterval: defineRoute({
    method: "put",
    path: "/api/v1/organisation/review-interval",
    summary:
      "Set how many months pass between periodic risk reviews; it applies to reviews scheduled from now on",
    permission: "organisation.manage",
    request: { body: ReviewIntervalInput },
    responses: { 200: OrganisationResponse, 409: ErrorResponse },
  }),
  setConcernRewards: defineRoute({
    method: "put",
    path: "/api/v1/organisation/concern-rewards",
    summary: "Turn concern rewards and recognition on or off without changing concern reporting",
    permission: "organisation.manage",
    recentAuth: true,
    request: { body: ConcernRewardsSettingsInput },
    responses: { 200: ConcernRewardsSettingsDto, 409: ErrorResponse },
  }),
  resumeConcernRewards: defineRoute({
    method: "post",
    path: "/api/v1/organisation/concern-rewards/resume",
    summary:
      "Explicitly resume suspended and pending reward evaluations without backfilling reports",
    permission: "organisation.manage",
    recentAuth: true,
    responses: { 200: ResumeConcernRewardsResponse, 409: ErrorResponse },
  }),
  setModule: defineRoute({
    method: "put",
    path: "/api/v1/organisation/modules/{key}",
    summary:
      "Turn an optional module on or off; off hides it (its routes answer 404) and keeps its data",
    permission: "organisation.manage",
    request: { params: z.object({ key: ModuleKeySchema }), body: SetModuleInput },
    responses: { 200: ModulesResponse },
  }),
  completeSetup: defineRoute({
    method: "post",
    path: "/api/v1/organisation/setup/complete",
    summary: "Mark setup complete once every step is done; repeating it changes nothing",
    permission: "organisation.manage",
    responses: { 200: CompleteSetupResponse, 409: ErrorResponse },
  }),
};
