"use server";

import {
  identityRoutes,
  ViewModeSchema,
  type PreferencesResponse,
  type ViewMode,
} from "@isms/contracts";
import { callApi, type CallResult } from "../server-api";

/** Saves the user's view mode. Presentation only: it never changes what the user may do. */
export async function saveViewMode(viewMode: ViewMode): Promise<CallResult<PreferencesResponse>> {
  // Server actions are public endpoints; never trust the client's type.
  const parsed = ViewModeSchema.safeParse(viewMode);
  if (!parsed.success) return { ok: false, kind: "invalid", details: [] };
  return callApi(identityRoutes.updatePreferences, { body: { viewMode: parsed.data } });
}
