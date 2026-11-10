"use server";

import {
  ConcernRewardsSettingsInput,
  organisationRoutes,
  type ConcernRewardsSettingsDto,
  type ResumeConcernRewardsResponse,
} from "@isms/contracts";
import type { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const PATH = "/settings/concern-reporting";

export async function updateConcernRewards(
  input: z.input<typeof ConcernRewardsSettingsInput>,
): Promise<CallResult<ConcernRewardsSettingsDto>> {
  const parsed = ConcernRewardsSettingsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(organisationRoutes.setConcernRewards, { body: parsed.data }, { returnTo: PATH }),
    PATH,
  );
}

export async function resumeConcernRewards(): Promise<CallResult<ResumeConcernRewardsResponse>> {
  return revalidated(
    await callApi(organisationRoutes.resumeConcernRewards, {}, { returnTo: PATH }),
    PATH,
  );
}
