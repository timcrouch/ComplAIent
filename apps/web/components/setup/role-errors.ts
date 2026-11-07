import { conflictReasons } from "@isms/contracts";
import type { CallResult } from "../../lib/server-api";
import type { SetupErrorKey } from "./save-flow";

type Failure = Exclude<CallResult<unknown>, { ok: true }>;

/**
 * The message for a refused grant or revoke; the API's own text is never shown. Sign-in
 * problems have no message: the caller sends the browser to sign in again.
 */
export function roleFailureMessage(result: Failure): SetupErrorKey {
  switch (result.kind) {
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "changed";
    case "conflict": {
      const reason = conflictReasons(result.details)[0]?.reason;
      return reason === "lastAdministrator" || reason === "duplicateRoleAssignment"
        ? reason
        : "notAccepted";
    }
    case "invalid":
      return result.details.some((d) => d.path.startsWith("scope")) ? "scope" : "notAccepted";
    default:
      return "unavailable";
  }
}
