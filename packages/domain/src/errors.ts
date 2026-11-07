export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RECENT_AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL";

/** Every error code, in one runtime list (contracts builds its enum from this). */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RECENT_AUTH_REQUIRED",
  "AUTH_UNAVAILABLE",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL",
] as const satisfies readonly ErrorCode[];

export type ErrorDetail = { path: string; message: string };

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}
