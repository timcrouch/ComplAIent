import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { DomainError, type ErrorCode, type ErrorDetail } from "@isms/domain";
import type { Request, Response } from "express";
import { getRequestId } from "./request-id.js";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  RECENT_AUTH_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  AUTH_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const GENERIC_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Request validation failed",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Forbidden",
  RECENT_AUTH_REQUIRED: "Recent authentication required",
  NOT_FOUND: "Not found",
  CONFLICT: "Conflict",
  RATE_LIMITED: "Too many requests",
  PAYLOAD_TOO_LARGE: "Request body too large",
  AUTH_UNAVAILABLE: "Authentication service unavailable",
  INTERNAL: "Internal server error",
};

export type MappedError = {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  /** True when the error was not an expected, deliberately raised one. */
  unexpected: boolean;
};

/** Client errors (4xx) keep their status; the code is the closest contract code. */
function clientError(status: number): MappedError {
  const code: ErrorCode =
    status === 401
      ? "UNAUTHENTICATED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 409
            ? "CONFLICT"
            : status === 413
              ? "PAYLOAD_TOO_LARGE"
              : status === 429
                ? "RATE_LIMITED"
                : "VALIDATION_FAILED";
  const message =
    code === "VALIDATION_FAILED"
      ? status === 400
        ? "Malformed request"
        : "Request not acceptable"
      : GENERIC_MESSAGE[code];
  return { status, code, message, unexpected: false };
}

const internal = (): MappedError => ({
  status: 500,
  code: "INTERNAL",
  message: GENERIC_MESSAGE.INTERNAL,
  unexpected: true,
});

function bodyParserStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { status, type } = err as { status?: unknown; type?: unknown };
  // body-parser / http-errors style: a string `type` plus a 4xx status.
  return typeof type === "string" && typeof status === "number" && status >= 400 && status < 500
    ? status
    : undefined;
}

/** Pure mapping from any thrown value to the contract error shape. Never exposes internals. */
export function toErrorResponse(err: unknown): MappedError {
  if (err instanceof DomainError) {
    if (err.code === "INTERNAL") return internal();
    return {
      status: STATUS_BY_CODE[err.code],
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      unexpected: false,
    };
  }
  const parserStatus = bodyParserStatus(err);
  if (parserStatus !== undefined) return clientError(parserStatus);
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status >= 400 && status < 500) return clientError(status);
  }
  return internal();
}

@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = getRequestId(req);
    const mapped = toErrorResponse(exception);

    if (mapped.unexpected) {
      this.logger.error({ msg: "Unhandled error", requestId, err: exception });
    }

    // A refused request whose body was not read to the end (an upload stopped before or
    // during its file): close the connection rather than drain the rest of the body.
    if (!req.complete || mapped.status === 413) res.setHeader("Connection", "close");
    res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId,
        ...(mapped.details ? { details: mapped.details } : {}),
      },
    });
  }
}
