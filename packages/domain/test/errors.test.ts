import { describe, expect, it } from "vitest";
import { DomainError, ERROR_CODES, newId, systemClock } from "../src/index.js";

describe("DomainError", () => {
  it("carries code, message and details", () => {
    const e = new DomainError("FORBIDDEN", "x", [{ path: "a", message: "b" }]);
    expect(e.code).toBe("FORBIDDEN");
    expect(e.message).toBe("x");
    expect(e.details).toEqual([{ path: "a", message: "b" }]);
    expect(e).toBeInstanceOf(Error);
  });
});

describe("newId", () => {
  it("returns a UUIDv7", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("systemClock", () => {
  it("returns a Date", () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });
});

describe("ERROR_CODES", () => {
  it("includes PAYLOAD_TOO_LARGE", () => {
    expect(ERROR_CODES).toContain("PAYLOAD_TOO_LARGE");
  });
});
