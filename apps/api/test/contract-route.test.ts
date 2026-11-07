import { DomainError } from "@isms/domain";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { toNestPath } from "../src/platform/contract-route.js";
import { parseWithSchema } from "../src/platform/zod-pipe.js";

describe("toNestPath", () => {
  it("converts OpenAPI parameters to Nest parameters", () => {
    expect(toNestPath("/api/v1/risks/{id}/controls/{controlId}")).toBe(
      "/api/v1/risks/:id/controls/:controlId",
    );
    expect(toNestPath("/api/v1/health")).toBe("/api/v1/health");
  });
});

describe("parseWithSchema", () => {
  const schema = z.object({ n: z.number(), name: z.string().min(3) }).strict();

  it("returns the parsed value", () => {
    expect(parseWithSchema(schema, { n: 1, name: "abc" })).toEqual({ n: 1, name: "abc" });
  });

  it("throws VALIDATION_FAILED with path and message per issue, without echoing input", () => {
    const secret = "SuperSecretValue123";
    let error: unknown;
    try {
      parseWithSchema(schema, { n: secret, name: "x", [secret]: 1 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    const err = error as DomainError;
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details?.map((d) => d.path).sort()).toEqual(["", "n", "name"]);
    expect(JSON.stringify(err.details) + err.message).not.toContain(secret);
  });
});
