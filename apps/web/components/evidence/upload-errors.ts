import { conflictReasons } from "@isms/contracts";
import type messages from "../../messages/index";
import type { UploadResult } from "../../lib/upload";

export type EvidenceErrorKey = keyof (typeof messages)["evidence"]["errors"];
type UploadFailure = Exclude<UploadResult, { ok: true }>;

/** The words for a refused upload; null when the browser is leaving to sign in again. */
export function uploadErrorKey(result: UploadFailure): EvidenceErrorKey | null {
  switch (result.kind) {
    case "signed-out":
    case "reauth":
      return null;
    case "too-large":
      return "tooLarge";
    case "invalid": {
      const file = result.details.find((d) => d.path === "file")?.message;
      if (file === "empty") return "empty";
      if (file === "evidenceTypeNotAllowed") return "typeNotAllowed";
      if (file === "unreadable") return "unreadable";
      if (file === "extraParts") return "unreadable";
      if (file === "aborted" || file === "timeout") return "unavailable";
      return "invalid";
    }
    case "conflict": {
      const reason = conflictReasons(result.details)[0]?.reason;
      if (reason === "controlNotAccepted") return "controlNotAccepted";
      if (reason === "taskClosed") return "taskClosed";
      return reason === "evidenceHashMismatch" ? "unavailable" : "invalid";
    }
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "notFound";
    default:
      return "unavailable";
  }
}

/** Errors that are about the chosen file, shown on the file field. */
export const FILE_ERRORS: ReadonlySet<EvidenceErrorKey> = new Set([
  "fileRequired",
  "empty",
  "tooLarge",
  "typeNotAllowed",
  "unreadable",
]);

const megabytes = new Intl.NumberFormat("en-GB", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});
const kilobytes = new Intl.NumberFormat("en-GB", {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 0,
});

/** A byte count in words ("25 MB"), counted in units of 1,024. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? megabytes.format(mb) : kilobytes.format(Math.max(1, bytes / 1024));
}
