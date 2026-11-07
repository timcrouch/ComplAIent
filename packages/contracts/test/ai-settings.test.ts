import { describe, expect, it } from "vitest";
import {
  AiSettingsUpdateInput,
  AiTestConnectionResponse,
  SetAiKeyInput,
  aiSettingsRoutes,
  allRoutes,
  buildOpenApiDocument,
} from "../src/index.js";

const KEY = "sk-or-v1-" + "a".repeat(40) + "WXYZ";

describe("AI settings contracts", () => {
  it("accepts a printable key, trimmed, and refuses whitespace, control characters and odd lengths", () => {
    expect(SetAiKeyInput.parse({ key: `  ${KEY}\n` }).key).toBe(KEY);
    for (const key of [
      "short-key",
      "x".repeat(201),
      `${KEY.slice(0, 20)} ${KEY.slice(20)}`,
      `${KEY.slice(0, 10)}\u0000${KEY.slice(10)}`,
      `${KEY.slice(0, 10)}\t${KEY.slice(10)}`,
      `${KEY}é`,
    ]) {
      expect(SetAiKeyInput.safeParse({ key }).success).toBe(false);
    }
    expect(SetAiKeyInput.safeParse({ key: KEY, extra: 1 }).success).toBe(false);
  });

  it("needs at least one setting and refuses unknown fields", () => {
    expect(AiSettingsUpdateInput.safeParse({}).success).toBe(false);
    expect(AiSettingsUpdateInput.safeParse({ models: {} }).success).toBe(false);
    expect(AiSettingsUpdateInput.safeParse({ key: KEY }).success).toBe(false);
    expect(AiSettingsUpdateInput.safeParse({ models: { other: "m" } }).success).toBe(false);
    expect(AiSettingsUpdateInput.parse({ enabled: true })).toEqual({ enabled: true });
    expect(AiSettingsUpdateInput.parse({ models: { conversation: null } })).toEqual({
      models: { conversation: null },
    });
  });

  it("names the connection test reasons", () => {
    expect(AiTestConnectionResponse.safeParse({ ok: false, reason: "auth" }).success).toBe(true);
    expect(AiTestConnectionResponse.safeParse({ ok: false, reason: "other" }).success).toBe(false);
    expect(AiTestConnectionResponse.safeParse({ ok: true, model: "m" }).success).toBe(true);
  });

  it("puts every route under settings.ai.manage, and every write behind a recent sign-in", () => {
    const doc = buildOpenApiDocument(allRoutes);
    const routes = Object.values(aiSettingsRoutes);
    expect(routes).toHaveLength(6);
    for (const route of routes) {
      expect(allRoutes).toContain(route);
      const op = doc.paths?.[route.path]?.[route.method];
      expect(op?.["x-permission"]).toBe("settings.ai.manage");
      expect(op?.["x-recent-auth"]).toBe(route.method === "get" ? undefined : true);
    }
  });
});
