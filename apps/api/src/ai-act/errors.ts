import { type ConflictReason, conflictDetail } from "@isms/contracts";
import { Prisma } from "@isms/database";
import { DomainError } from "@isms/domain";

export const invalid = (path: string, message: string): DomainError =>
  new DomainError("VALIDATION_FAILED", "Request validation failed", [{ path, message }]);

export const conflict = (reason: ConflictReason, message: string): DomainError =>
  new DomainError("CONFLICT", message, [conflictDetail(reason)]);

export const aiUnavailable = (reason: string): DomainError =>
  new DomainError("CONFLICT", "The AI assistant is not available", [
    conflictDetail("aiUnavailable", reason, "aiUnavailable"),
  ]);

export const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
