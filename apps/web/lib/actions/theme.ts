"use server";

import { identityRoutes, ThemeSchema, type PreferencesResponse, type Theme } from "@isms/contracts";
import { callApi, type CallResult } from "../server-api";

/** Saves the user's colour theme on their account (#2). Presentation only. */
export async function saveTheme(theme: Theme): Promise<CallResult<PreferencesResponse>> {
  // Server actions are public endpoints; never trust the client's type.
  const parsed = ThemeSchema.safeParse(theme);
  if (!parsed.success) return { ok: false, kind: "invalid", details: [] };
  return callApi(identityRoutes.updatePreferences, { body: { theme: parsed.data } });
}
