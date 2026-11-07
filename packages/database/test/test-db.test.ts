import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl, resetTestDatabase } from "../src/test-db.js";

describe("assertTestDatabaseUrl", () => {
  it("accepts a database whose name ends in _test", () => {
    expect(() => {
      assertTestDatabaseUrl("postgresql://u:p@localhost:5432/isms_test");
    }).not.toThrow();
  });

  it.each([
    "postgresql://u:p@localhost:5432/isms",
    "postgresql://u:p@localhost:5432/isms_test_backup",
    "postgresql://u:p@localhost:5432/test",
    "postgresql://u:p@localhost:5432/",
    "postgresql://u:p@localhost:5432/isms?x=_test",
  ])("refuses %s", (url) => {
    expect(() => {
      assertTestDatabaseUrl(url);
    }).toThrow(/_test/);
  });

  it("does not echo credentials in the error", () => {
    let message = "";
    try {
      assertTestDatabaseUrl("postgresql://u:secret-pw@localhost:5432/isms");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/_test/);
    expect(message).not.toContain("secret-pw");
  });
});

describe("resetTestDatabase", () => {
  it("refuses to run against a non-test database before connecting", async () => {
    await expect(resetTestDatabase("postgresql://u:p@127.0.0.1:1/isms")).rejects.toThrow(/_test/);
  });
});
