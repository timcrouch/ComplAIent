"use server";

import { demoRoutes, DemoConfirmInput } from "@isms/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { invalid } from "../../../lib/action-results";
import { sessionCookie } from "../../../lib/cookie";
import { callApi, type CallResult } from "../../../lib/server-api";

// Both are recentAuth routes: a stale sign-in comes back as `reauth` with a step-up sign-in
// URL that returns to Setup.
const RETURN_TO = { returnTo: "/setup" };

/**
 * The server wiped every session, so the local cookie points at nothing: clear it and go to
 * sign-in. `redirect` throws, so this only returns by not being reached.
 */
async function signedOutEverywhere(): Promise<never> {
  const cookie = sessionCookie();
  (await cookies()).delete({ name: cookie.name, ...cookie.options });
  redirect("/");
}

/** Resets, then loads the sample year. Success never returns: everyone is signed out. */
export async function loadSampleData(confirm: string): Promise<CallResult<never>> {
  const body = DemoConfirmInput.safeParse({ confirm });
  if (!body.success) return invalid(body.error);
  const result = await callApi(demoRoutes.loadSample, { body: body.data }, RETURN_TO);
  if (result.ok) return signedOutEverywhere();
  return result;
}

/** Deletes everything back to a fresh install. Success never returns: everyone is signed out. */
export async function resetEverything(confirm: string): Promise<CallResult<never>> {
  const body = DemoConfirmInput.safeParse({ confirm });
  if (!body.success) return invalid(body.error);
  const result = await callApi(demoRoutes.reset, { body: body.data }, RETURN_TO);
  if (result.ok) return signedOutEverywhere();
  return result;
}
