import type { AiSettingsDto } from "@isms/contracts";
import { describe, expect, it } from "vitest";
import { frameworkSuggestionsReady } from "../../lib/ai-availability";

const ready: AiSettingsDto = {
  enabled: true,
  euOnly: true,
  zeroRetention: true,
  key: { set: false },
  models: { conversation: "m", controls: "m", frameworks: "m" },
  readiness: { ready: true, reason: null },
  secretsKeyConfigured: true,
  provider: "mock",
  nonEuRoutingAllowed: false,
};

describe("frameworkSuggestionsReady", () => {
  it("is ready when every purpose is", () => {
    expect(frameworkSuggestionsReady(ready)).toBe(true);
  });

  it("is ready when only another purpose lacks a model", () => {
    const s = {
      ...ready,
      models: { conversation: null, controls: null, frameworks: "m" },
      readiness: { ready: false, reason: "noModel" as const },
    };
    expect(frameworkSuggestionsReady(s)).toBe(true);
  });

  it.each([
    ["switched off", { enabled: false, readiness: { ready: false, reason: "disabled" as const } }],
    [
      "no framework model",
      {
        models: { conversation: "m", controls: "m", frameworks: null },
        readiness: { ready: false, reason: "noModel" as const },
      },
    ],
    ["no key", { readiness: { ready: false, reason: "noKey" as const } }],
    ["privacy off", { readiness: { ready: false, reason: "privacyOff" as const } }],
  ])("is not ready when %s", (_name, change) => {
    expect(frameworkSuggestionsReady({ ...ready, ...change })).toBe(false);
  });
});
