"use server";

import {
  FrameworksInput,
  ModuleKeySchema,
  organisationRoutes,
  ProfileInput,
  ReviewIntervalInput,
  RiskScaleInput,
  SetModuleInput,
  UnitsInput,
  type CompleteSetupResponse,
  type FrameworksResponse,
  type ModuleKey,
  type ModulesResponse,
  type OrganisationResponse,
  type RiskScaleDto,
  type UnitsResponse,
} from "@isms/contracts";
import type { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

/** Saves the organisation's name, description and approximate headcount. */
export async function saveProfile(
  input: z.input<typeof ProfileInput>,
): Promise<CallResult<OrganisationResponse>> {
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(
      organisationRoutes.updateProfile,
      { body: parsed.data },
      { returnTo: "/setup/organisation" },
    ),
  );
}

/**
 * Replaces the sites and departments in one call (PF4): the API applies both lists or
 * neither, so a refused removal never leaves the other list half-saved.
 */
export async function saveUnits(
  input: z.input<typeof UnitsInput>,
): Promise<CallResult<UnitsResponse>> {
  const parsed = UnitsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(
      organisationRoutes.replaceUnits,
      { body: parsed.data },
      { returnTo: "/setup/sites" },
    ),
  );
}

/** Confirms the chosen framework versions; confirmed ones not chosen are removed. */
export async function saveFrameworks(ids: string[]): Promise<CallResult<FrameworksResponse>> {
  const parsed = FrameworksInput.safeParse({ frameworkVersionIds: ids });
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(
      organisationRoutes.setFrameworks,
      { body: parsed.data },
      { returnTo: "/setup/frameworks" },
    ),
  );
}

/**
 * Asks the AI which frameworks apply, from the saved answers. The API stores them only as
 * suggestions with reasoning; nothing is confirmed until the step is saved with them checked.
 * 409 `aiUnavailable.<reason>` or `setupIncomplete.profile` when it cannot run.
 */
export async function suggestFrameworks(): Promise<CallResult<FrameworksResponse>> {
  return revalidated(
    await callApi(organisationRoutes.suggestFrameworks, {}, { returnTo: "/setup/frameworks" }),
  );
}

/** Saves the appetite threshold; a new value becomes a new risk scale version. */
export async function saveRiskAppetite(threshold: number): Promise<CallResult<RiskScaleDto>> {
  const parsed = RiskScaleInput.safeParse({ appetiteThreshold: threshold });
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(
      organisationRoutes.setRiskScale,
      { body: parsed.data },
      { returnTo: "/setup/risk-appetite" },
    ),
  );
}

/** Saves how many months pass between periodic risk reviews. 409 `setupIncomplete.profile` before the profile is saved. */
export async function saveReviewInterval(
  months: number,
): Promise<CallResult<OrganisationResponse>> {
  const parsed = ReviewIntervalInput.safeParse({ months });
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(
      organisationRoutes.setReviewInterval,
      { body: parsed.data },
      { returnTo: "/setup/risk-appetite" },
    ),
  );
}

/** Marks setup complete. Home changes too, so every page is refreshed, not only /setup. */
export async function completeSetup(): Promise<CallResult<CompleteSetupResponse>> {
  return revalidated(
    await callApi(organisationRoutes.completeSetup, {}, { returnTo: "/setup/review" }),
    "/",
  );
}

/**
 * Turns an optional module on or off; off hides it and keeps its data. Every page is
 * refreshed, not only /setup: the navigation shows or hides the module's item.
 */
export async function setModule(
  key: ModuleKey,
  enabled: boolean,
): Promise<CallResult<ModulesResponse>> {
  const parsedKey = ModuleKeySchema.safeParse(key);
  if (!parsedKey.success) return invalid(parsedKey.error);
  const body = SetModuleInput.safeParse({ enabled });
  if (!body.success) return invalid(body.error);
  return revalidated(
    await callApi(
      organisationRoutes.setModule,
      { params: { key: parsedKey.data }, body: body.data },
      { returnTo: "/setup/modules" },
    ),
    "/",
  );
}
