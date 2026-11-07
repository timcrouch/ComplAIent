import { HttpException, NotFoundException } from "@nestjs/common";
import { DomainError } from "@isms/domain";
import { describe, expect, it } from "vitest";
import { toErrorResponse } from "../src/platform/error-filter.js";

describe("toErrorResponse", () => {
  it.each([
    ["VALIDATION_FAILED", 400],
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["RECENT_AUTH_REQUIRED", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["RATE_LIMITED", 429],
    ["PAYLOAD_TOO_LARGE", 413],
    ["AUTH_UNAVAILABLE", 503],
    ["INTERNAL", 500],
  ] as const)("maps %s to %i", (code, status) => {
    const mapped = toErrorResponse(new DomainError(code, "msg"));
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
  });

  it("keeps details on domain errors", () => {
    const mapped = toErrorResponse(
      new DomainError("VALIDATION_FAILED", "bad", [{ path: "n", message: "Expected number" }]),
    );
    expect(mapped.details).toEqual([{ path: "n", message: "Expected number" }]);
  });

  it("never exposes the message of an INTERNAL domain error", () => {
    expect(toErrorResponse(new DomainError("INTERNAL", "db password is hunter2")).message).toBe(
      "Internal server error",
    );
  });

  it("maps unknown errors to a generic INTERNAL", () => {
    const mapped = toErrorResponse(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    expect(mapped).toMatchObject({
      status: 500,
      code: "INTERNAL",
      message: "Internal server error",
    });
  });

  it("maps framework HTTP exceptions by status", () => {
    expect(toErrorResponse(new NotFoundException("Cannot GET /x")).code).toBe("NOT_FOUND");
    expect(toErrorResponse(new HttpException("slow down", 429)).code).toBe("RATE_LIMITED");
  });

  it.each([405, 406, 415, 418, 422])(
    "keeps client error status %i as VALIDATION_FAILED, not INTERNAL",
    (status) => {
      const mapped = toErrorResponse(new HttpException("framework text", status));
      expect(mapped).toMatchObject({ status, code: "VALIDATION_FAILED", unexpected: false });
      expect(mapped.message).not.toContain("framework text");
    },
  );

  it("treats 5xx HTTP exceptions as unexpected INTERNAL", () => {
    expect(toErrorResponse(new HttpException("bad gateway", 502))).toMatchObject({
      status: 500,
      code: "INTERNAL",
      unexpected: true,
    });
  });

  it("maps an oversized-body HttpException to 413 PAYLOAD_TOO_LARGE", () => {
    expect(toErrorResponse(new HttpException("request entity too large", 413))).toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("maps body-parser errors by their client status", () => {
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large",
    });
    expect(toErrorResponse(tooLarge)).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    const malformed = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      type: "entity.parse.failed",
    });
    expect(toErrorResponse(malformed)).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    const unsupported = Object.assign(new Error("unsupported charset"), {
      status: 415,
      type: "charset.unsupported",
    });
    expect(toErrorResponse(unsupported)).toMatchObject({ status: 415, unexpected: false });
    const unsupportedEntity = Object.assign(new Error("unsupported content encoding"), {
      status: 415,
      type: "encoding.unsupported",
    });
    expect(toErrorResponse(unsupportedEntity).code).not.toBe("INTERNAL");
  });
});
