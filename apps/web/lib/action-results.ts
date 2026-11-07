import "server-only";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { CallResult } from "./server-api";

/**
 * Server actions are public endpoints: input is checked against the contract there too, so a
 * bad request comes back as `invalid` with field paths (callApi would report "unavailable").
 * The message is the Zod issue code, never text meant for people.
 */
export function invalid(error: z.ZodError): CallResult<never> {
  return {
    ok: false,
    kind: "invalid",
    details: error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.code })),
  };
}

/** After a save, no page under `path` may come back from the client router cache with old data. */
export function revalidated<T>(result: CallResult<T>, path = "/setup"): CallResult<T> {
  if (result.ok) revalidatePath(path, "layout");
  return result;
}
