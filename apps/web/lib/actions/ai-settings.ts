"use server";

import {
  aiSettingsRoutes,
  AiSettingsUpdateInput,
  SetAiKeyInput,
  type AiSettingsDto,
  type AiTestConnectionResponse,
} from "@isms/contracts";
import type { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

// Every write is a recentAuth route: a stale sign-in comes back as `reauth` with a step-up
// sign-in URL that returns here.
const PATH = "/settings/ai";
const RETURN_TO = { returnTo: PATH };

/**
 * Saves or replaces the provider key. The key goes to the API and nowhere else: the result is
 * the settings DTO (its last 4 characters only), and a refused key is reported by field path
 * and Zod issue code, never echoed.
 */
export async function saveAiKey(key: string): Promise<CallResult<AiSettingsDto>> {
  const parsed = SetAiKeyInput.safeParse({ key });
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(aiSettingsRoutes.setKey, { body: parsed.data }, RETURN_TO),
    PATH,
  );
}

/** Removes the provider key; AI stops until a new one is saved. */
export async function removeAiKey(): Promise<CallResult<AiSettingsDto>> {
  return revalidated(await callApi(aiSettingsRoutes.removeKey, {}, RETURN_TO), PATH);
}

/** Changes the master switch, the privacy switches or the models; only the given fields. */
export async function updateAiSettings(
  input: z.input<typeof AiSettingsUpdateInput>,
): Promise<CallResult<AiSettingsDto>> {
  const parsed = AiSettingsUpdateInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return revalidated(
    await callApi(aiSettingsRoutes.update, { body: parsed.data }, RETURN_TO),
    PATH,
  );
}

/** Sends one harmless request with the saved key and settings; the outcome is recorded. */
export async function testAiConnection(): Promise<CallResult<AiTestConnectionResponse>> {
  return revalidated(await callApi(aiSettingsRoutes.test, {}, RETURN_TO), PATH);
}
