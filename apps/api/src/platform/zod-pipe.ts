import { DomainError, type ErrorDetail } from "@isms/domain";
import type { z } from "zod";

// Messages derive from issue.code, never from zod's own text, which can echo input
// (for example unrecognized key names). Only author-written custom messages pass through.
function describe(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `Expected ${issue.expected}`;
    case "too_small":
      return "Value is too small or too short";
    case "too_big":
      return "Value is too large or too long";
    case "invalid_format":
      return "Value has an invalid format";
    case "invalid_value":
      return "Value is not one of the allowed values";
    case "unrecognized_keys":
      return "Unrecognized field";
    case "custom":
      return issue.message;
    default:
      return "Invalid value";
  }
}

export function toErrorDetails(issues: readonly z.core.$ZodIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: describe(issue),
  }));
}

export type ParseOutcome<T> = { ok: true; data: T } | { ok: false; details: ErrorDetail[] };

export function tryParse<T extends z.ZodType>(
  schema: T,
  input: unknown,
): ParseOutcome<z.output<T>> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, details: toErrorDetails(result.error.issues) };
}

export const validationFailed = (details: ErrorDetail[]): DomainError =>
  new DomainError("VALIDATION_FAILED", "Request validation failed", details);

export function parseWithSchema<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const outcome = tryParse(schema, input);
  if (outcome.ok) return outcome.data;
  throw validationFailed(outcome.details);
}
