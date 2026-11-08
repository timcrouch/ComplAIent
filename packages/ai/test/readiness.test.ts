import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aiReadiness, MODEL_KEY_BY_PURPOSE } from "../src/readiness.js";
import { sealSecret } from "../src/secret-box.js";
import { defaultAiSettings, type AiSettingsRow } from "../src/store.js";

const SECRETS_KEY = randomBytes(32);

function settings(overrides: Partial<AiSettingsRow> = {}): AiSettingsRow {
  return {
    ...defaultAiSettings(),
    enabled: true,
    sealedKey: sealSecret("sk-or-test-only-0000", SECRETS_KEY),
    keyLast4: "0000",
    keySetById: "00000000-0000-7000-8000-000000000001",
    keySetAt: new Date("2026-11-05T00:00:00Z"),
    models: { conversation: "vendor/a", controls: "vendor/b", frameworks: "vendor/c" },
    ...overrides,
  };
}

describe("aiReadiness", () => {
  it("is ready with the purpose's model", () => {
    expect(aiReadiness(settings(), "concern_turn", SECRETS_KEY)).toEqual({
      ready: true,
      model: "vendor/a",
    });
    expect(aiReadiness(settings(), "control_suggestion", SECRETS_KEY)).toEqual({
      ready: true,
      model: "vendor/b",
    });
    expect(aiReadiness(settings(), "framework_suggestion", SECRETS_KEY)).toEqual({
      ready: true,
      model: "vendor/c",
    });
  });

  it("maps purposes to model keys", () => {
    expect(MODEL_KEY_BY_PURPOSE).toEqual({
      concern_turn: "conversation",
      control_suggestion: "controls",
      framework_suggestion: "frameworks",
      connection_test: "conversation",
      posture_summary: "conversation",
      control_test_steps: "controls",
      ai_act_classification: "controls",
      ai_act_obligation_guidance: "controls",
    });
  });

  it.each([
    [{ sealedKey: null }, "noKey"],
    [{ euOnly: false }, "privacyOff"],
    [{ zeroRetention: false }, "privacyOff"],
    [{ enabled: false }, "disabled"],
    [{ models: {} }, "noModel"],
  ] as [Partial<AiSettingsRow>, string][])("readiness %j → %s", (overrides, reason) => {
    expect(aiReadiness(settings(overrides), "concern_turn", SECRETS_KEY)).toEqual({
      ready: false,
      reason,
    });
  });

  it("a stored key without AI_SECRETS_KEY is secretsKeyMissing; with the wrong key keyUnreadable", () => {
    expect(aiReadiness(settings(), "concern_turn", undefined)).toEqual({
      ready: false,
      reason: "secretsKeyMissing",
    });
    expect(aiReadiness(settings(), "concern_turn", randomBytes(32))).toEqual({
      ready: false,
      reason: "keyUnreadable",
    });
    // Without a stored key the missing secrets key does not matter yet.
    expect(aiReadiness(settings({ sealedKey: null }), "concern_turn", undefined)).toEqual({
      ready: false,
      reason: "noKey",
    });
  });

  describe("with non-EU routing allowed (development only)", () => {
    const allow = { allowNonEuRouting: true };

    it("accepts euOnly off while zero retention is on", () => {
      expect(aiReadiness(settings({ euOnly: false }), "concern_turn", SECRETS_KEY, allow)).toEqual({
        ready: true,
        model: "vendor/a",
      });
      expect(
        aiReadiness(settings({ euOnly: false }), "connection_test", SECRETS_KEY, allow),
      ).toEqual({ ready: true, model: "vendor/a" });
    });

    it("still refuses when zero retention is off, whatever euOnly is", () => {
      for (const euOnly of [true, false]) {
        expect(
          aiReadiness(
            settings({ euOnly, zeroRetention: false }),
            "concern_turn",
            SECRETS_KEY,
            allow,
          ),
        ).toEqual({ ready: false, reason: "privacyOff" });
      }
    });

    it("is unchanged when the flag is off or explicitly false", () => {
      for (const options of [undefined, { allowNonEuRouting: false }]) {
        expect(
          aiReadiness(settings({ euOnly: false }), "concern_turn", SECRETS_KEY, options),
        ).toEqual({ ready: false, reason: "privacyOff" });
      }
    });
  });

  it("checks in order: secretsKeyMissing, noKey, keyUnreadable, privacyOff, disabled, noModel", () => {
    const allWrong = settings({ euOnly: false, enabled: false, models: {} });
    expect(aiReadiness(allWrong, "concern_turn", undefined)).toMatchObject({
      reason: "secretsKeyMissing",
    });
    expect(aiReadiness(allWrong, "concern_turn", randomBytes(32))).toMatchObject({
      reason: "keyUnreadable",
    });
    expect(aiReadiness(allWrong, "concern_turn", SECRETS_KEY)).toMatchObject({
      reason: "privacyOff",
    });
    expect(aiReadiness({ ...allWrong, euOnly: true }, "concern_turn", SECRETS_KEY)).toMatchObject({
      reason: "disabled",
    });
  });

  it("connection_test ignores disabled and noModel but not privacy", () => {
    expect(
      aiReadiness(settings({ enabled: false, models: {} }), "connection_test", SECRETS_KEY),
    ).toEqual({
      ready: true,
      model: null,
    });
    expect(aiReadiness(settings({ enabled: false }), "connection_test", SECRETS_KEY)).toEqual({
      ready: true,
      model: "vendor/a",
    });
    expect(aiReadiness(settings({ zeroRetention: false }), "connection_test", SECRETS_KEY)).toEqual(
      {
        ready: false,
        reason: "privacyOff",
      },
    );
  });
});
