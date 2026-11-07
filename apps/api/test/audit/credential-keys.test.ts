import { createLogger } from "@isms/telemetry";
import { describe, expect, it } from "vitest";
import { isCredentialKey } from "../../src/audit/credential-keys.js";

describe("isCredentialKey", () => {
  it.each([
    "apiKey",
    "api_key",
    "API-KEY",
    "apikey",
    "refreshToken",
    "accessToken",
    "idToken",
    "clientSecret",
    "password",
    "newPassword",
    "passwd",
    "authorization",
    "Cookie",
    "privateKey",
    "encryptionKey",
    "secretKey",
    "aiSecretsKey",
    "key",
    "credentials",
  ])("treats %s as a credential", (k) => {
    expect(isCredentialKey(k)).toBe(true);
  });

  it.each([
    "objectKey",
    "sortKey",
    "riskKey",
    "frameworkKey",
    "primaryKey",
    "publicKey",
    "keyLast4",
    "monkey",
    "keyboard",
    "tokenizerVersion",
    "requirementRef",
  ])("keeps %s", (k) => {
    expect(isCredentialKey(k)).toBe(false);
  });
});

describe("the audit drop-log field", () => {
  it("is not redacted by the logger, so the dropped key name stays visible", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { level: "info", service: "t" },
      { write: (line: string) => void lines.push(line) },
    );
    logger.warn({
      event: "audit.credential_key_dropped",
      action: "a",
      droppedField: "clientSecret",
    });
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry["droppedField"]).toBe("clientSecret");
    expect(JSON.stringify(entry)).not.toContain("[Redacted]");
  });
});
