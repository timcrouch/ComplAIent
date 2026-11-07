import { MOCK_MODEL, ProviderError, createMockProvider, openSecret, sealSecret } from "@isms/ai";
import type { AiSettingsDto } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiGatewayService } from "../../src/ai/index.js";
import {
  type ErrorBody,
  KEY,
  OTHER_KEY,
  aiAudits,
  aiHarness,
  db,
  detailPaths,
  newSecretsKey,
} from "./harness.js";

const BASE = "/api/v1/settings/ai";
const secretsKey = newSecretsKey();
/** The provider seam: null uses the mock's default replies. */
let script: ((...args: unknown[]) => string | ProviderError) | null = null;

const h = aiHarness({
  secretsKey,
  providerFactory: () => createMockProvider(script ? { script } : {}),
});
/** The same app with AI_ALLOW_NON_EU_ROUTING on (development only). */
const settings = (res: { body: unknown }) => res.body as AiSettingsDto;
const code = (res: { body: unknown }) => (res.body as ErrorBody).error.code;

beforeAll(() => h.start());
beforeEach(async () => {
  script = null;
  await h.reset();
});
afterAll(async () => {
  await h.stop();
  await db.$disconnect();
});

describe("AI settings: access", () => {
  it("only administrators reach the settings routes: ciso 403", async () => {
    const as = { who: "carla" } as const;
    for (const res of [
      await h.get(BASE, as),
      await h.get(`${BASE}/models`, as),
      await h.put(`${BASE}/key`, { key: KEY }, as),
      await h.delete(`${BASE}/key`, as),
      await h.patch(BASE, { enabled: true }, as),
      await h.post(`${BASE}/test`, as),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe("FORBIDDEN");
    }
  });

  it("setting a key needs a recent sign-in", async () => {
    const old = { authAge: 600 };
    for (const res of [
      await h.put(`${BASE}/key`, { key: KEY }, old),
      await h.delete(`${BASE}/key`, old),
      await h.patch(BASE, { enabled: true }, old),
      await h.post(`${BASE}/test`, old),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe("RECENT_AUTH_REQUIRED");
    }
    expect(await db.aiSettings.count()).toBe(0);
    expect(await aiAudits()).toHaveLength(0);
    expect((await h.get(BASE, old)).status).toBe(200);
  });
});

describe("AI settings: the provider key", () => {
  it("never returns the key: GET, PUT and PATCH responses do not contain it", async () => {
    const put = await h.put(`${BASE}/key`, { key: KEY });
    expect(put.status).toBe(200);
    const patch = await h.patch(BASE, { enabled: true });
    const get = await h.get(BASE);
    for (const body of [put.text, patch.text, get.text]) {
      expect(body).not.toContain(KEY.slice(0, 20));
      expect(body).not.toContain("a".repeat(20));
    }
    expect(settings(put).key).toMatchObject({
      set: true,
      last4: "WXYZ",
      readable: true,
      setBy: { id: h.userIds.admin, displayName: "Anna Admin" },
    });
    expect(settings(get)).toMatchObject({ secretsKeyConfigured: true, provider: "mock" });
  });

  it("stores the key sealed: the database column does not contain the plaintext", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    const row = await db.aiSettings.findUniqueOrThrow({ where: { singleton: true } });
    const sealed = Buffer.from(row.sealedKey ?? []);
    expect(sealed.length).toBeGreaterThan(KEY.length);
    expect(sealed.toString("latin1")).not.toContain(KEY.slice(0, 12));
    expect(sealed.toString("latin1")).not.toContain("a".repeat(12));
    expect(openSecret(sealed, secretsKey)).toBe(KEY);
    expect(row).toMatchObject({ keyLast4: "WXYZ", keySetById: h.userIds.admin });
  });

  it("audits key set, replaced and removed with last4 only, never the key", async () => {
    expect((await h.put(`${BASE}/key`, { key: KEY })).status).toBe(200);
    expect((await h.put(`${BASE}/key`, { key: OTHER_KEY })).status).toBe(200);
    const removed = await h.delete(`${BASE}/key`);
    expect(removed.status).toBe(200);
    expect(settings(removed).key).toEqual({ set: false });
    expect((await h.delete(`${BASE}/key`)).status).toBe(200); // nothing to remove: not audited

    const rows = await aiAudits();
    expect(rows.map((r) => [r.action, r.beforeRef, r.afterRef, r.actorUserId])).toEqual([
      ["ai.key_set", null, { last4: "WXYZ" }, h.userIds.admin],
      ["ai.key_replaced", { last4: "WXYZ" }, { last4: "QRST" }, h.userIds.admin],
      ["ai.key_removed", { last4: "QRST" }, null, h.userIds.admin],
    ]);
    const all = JSON.stringify(await db.auditEvent.findMany());
    expect(all).not.toContain(KEY.slice(0, 12));
    expect(all).not.toContain(OTHER_KEY.slice(0, 12));
    const row = await db.aiSettings.findUniqueOrThrow({ where: { singleton: true } });
    expect(row).toMatchObject({ sealedKey: null, keyLast4: null, keySetById: null });
  });

  it("refuses a malformed key without echoing it", async () => {
    const spaced = `${KEY.slice(0, 20)} ${KEY.slice(20)}`;
    const res = await h.put(`${BASE}/key`, { key: spaced });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["key"]);
    expect(res.text).not.toContain(KEY.slice(0, 20));
    expect(await db.aiSettings.count()).toBe(0);
  });

  it("reports keyUnreadable after AI_SECRETS_KEY changes", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    await db.aiSettings.update({
      where: { singleton: true },
      data: { sealedKey: new Uint8Array(sealSecret(KEY, newSecretsKey())) },
    });
    const got = settings(await h.get(BASE));
    expect(got.key).toMatchObject({ set: true, last4: "WXYZ", readable: false });
    expect(got.readiness).toEqual({ ready: false, reason: "keyUnreadable" });
    const models = await h.get(`${BASE}/models`);
    expect(models.status).toBe(409);
    expect(detailPaths(models)).toEqual(["keyUnreadable"]);
    const test = await h.post(`${BASE}/test`);
    expect(test.body).toEqual({ ok: false, reason: "keyUnreadable" });
    // Entering the key again makes it readable.
    expect(settings(await h.put(`${BASE}/key`, { key: KEY })).key).toMatchObject({
      readable: true,
    });
  });
});

describe("AI settings: switches and models", () => {
  it("lists the provider's models and saves an offered one", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    const list = await h.get(`${BASE}/models`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ models: [{ ...MOCK_MODEL }] });
    const saved = await h.patch(BASE, {
      enabled: true,
      models: { conversation: MOCK_MODEL.id, controls: MOCK_MODEL.id, frameworks: MOCK_MODEL.id },
    });
    expect(saved.status).toBe(200);
    expect(settings(saved).readiness).toEqual({ ready: true, reason: null });
    const [audit] = await aiAudits().then((r) => r.filter((a) => a.action !== "ai.key_set"));
    expect(audit).toMatchObject({
      action: "ai.settings_changed",
      beforeRef: {
        enabled: false,
        models: { conversation: null, controls: null, frameworks: null },
      },
      afterRef: {
        enabled: true,
        models: { conversation: MOCK_MODEL.id, controls: MOCK_MODEL.id, frameworks: MOCK_MODEL.id },
      },
    });
  });

  it("refuses a model not offered by the provider", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    const res = await h.patch(BASE, { models: { controls: "other/model" } });
    expect(res.status).toBe(400);
    expect(detailPaths(res)).toEqual(["models.controls"]);
    expect(settings(await h.get(BASE)).models.controls).toBeNull();
    expect((await aiAudits()).map((a) => a.action)).toEqual(["ai.key_set"]);
  });

  it("turning euOnly off makes readiness privacyOff", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    await h.patch(BASE, { enabled: true, models: { conversation: MOCK_MODEL.id } });
    const off = await h.patch(BASE, { euOnly: false });
    expect(settings(off)).toMatchObject({ euOnly: false, zeroRetention: true });
    expect(settings(off).readiness).toEqual({ ready: false, reason: "privacyOff" });
    const audit = (await aiAudits()).at(-1);
    expect(audit).toMatchObject({
      action: "ai.settings_changed",
      beforeRef: { euOnly: true },
      afterRef: { euOnly: false },
    });
    // An unchanged value is not audited.
    const count = (await aiAudits()).length;
    await h.patch(BASE, { euOnly: false });
    expect(await aiAudits()).toHaveLength(count);
  });

  it("refuses listing and choosing models while a privacy setting is off", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    for (const off of [{ euOnly: false }, { euOnly: true, zeroRetention: false }]) {
      await h.patch(BASE, off);
      const list = await h.get(`${BASE}/models`);
      expect(list.status).toBe(409);
      expect(detailPaths(list)).toEqual(["aiUnavailable.privacyOff"]);
      const save = await h.patch(BASE, { models: { conversation: MOCK_MODEL.id } });
      expect(save.status).toBe(409);
      expect(detailPaths(save)).toEqual(["aiUnavailable.privacyOff"]);
      // Turning privacy back on in the same save as the choice is refused too.
      const both = await h.patch(BASE, {
        euOnly: true,
        zeroRetention: true,
        models: { conversation: MOCK_MODEL.id },
      });
      expect(both.status).toBe(409);
    }
    expect(settings(await h.get(BASE)).models.conversation).toBeNull();
  });

  it("refuses listing models without a key", async () => {
    const res = await h.get(`${BASE}/models`);
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.noKey"]);
  });
});

describe("AI settings: connection test", () => {
  it("test connection with the mock reports ok and records a connection_test interaction", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    const res = await h.post(`${BASE}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, model: MOCK_MODEL.id });
    const rows = await db.aiInteraction.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "connection_test",
      status: "ok",
      model: MOCK_MODEL.id,
      actorUserId: h.userIds.admin,
    });
    expect(JSON.stringify(rows[0]?.request)).toContain('Reply with {\\"ok\\":true}.');
    expect(JSON.stringify(rows)).not.toContain(KEY.slice(0, 12));
    const audit = (await aiAudits()).at(-1);
    expect(audit).toMatchObject({
      action: "ai.connection_tested",
      beforeRef: null,
      afterRef: { ok: true },
    });
  });

  it("test connection maps a rejected key to reason auth", async () => {
    script = () => new ProviderError("auth");
    await h.put(`${BASE}/key`, { key: KEY });
    const res = await h.post(`${BASE}/test`);
    expect(res.body).toEqual({ ok: false, reason: "auth" });
    expect((await aiAudits()).at(-1)).toMatchObject({
      action: "ai.connection_tested",
      afterRef: { ok: false, reason: "auth" },
    });
    expect(await db.aiInteraction.findMany()).toMatchObject([{ status: "provider_error" }]);
  });

  it("calls refused by readiness write no AiInteraction row", async () => {
    expect((await h.post(`${BASE}/test`)).body).toEqual({ ok: false, reason: "noKey" });
    await h.put(`${BASE}/key`, { key: KEY });
    await h.patch(BASE, { zeroRetention: false });
    expect((await h.post(`${BASE}/test`)).body).toEqual({ ok: false, reason: "privacyOff" });

    const gateway = h.app().get(AiGatewayService);
    const call = {
      system: "s",
      messages: [{ role: "user" as const, content: "hello" }],
      schema: z.object({ ok: z.boolean() }),
      schemaName: "connection_test",
      maxTokens: 10,
      timeoutMs: 1000,
      actorUserId: h.userIds.admin,
    };
    expect(await gateway.run("concern_turn", call)).toEqual({ ok: false, reason: "privacyOff" });
    await h.patch(BASE, { zeroRetention: true });
    expect(await gateway.run("concern_turn", call)).toEqual({ ok: false, reason: "disabled" });
    expect(await gateway.readiness("concern_turn")).toEqual({ ready: false, reason: "disabled" });
    expect(await db.aiInteraction.count()).toBe(0);
  });
});

describe("AI settings without AI_SECRETS_KEY", () => {
  const bare = aiHarness({ sharedIdp: () => h.idp() });
  beforeAll(() => bare.start());
  afterAll(() => bare.stop());

  it("refuses to save a key without AI_SECRETS_KEY: 409 secretsKeyMissing", async () => {
    const got = settings(await bare.get(BASE));
    expect(got).toMatchObject({ secretsKeyConfigured: false, key: { set: false } });
    expect(got.readiness).toEqual({ ready: false, reason: "noKey" });
    const res = await bare.put(`${BASE}/key`, { key: KEY });
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["secretsKeyMissing"]);
    expect(res.text).not.toContain(KEY.slice(0, 12));
    expect(await db.aiSettings.count()).toBe(0);
    expect(await aiAudits()).toHaveLength(0);
  });

  it("reports secretsKeyMissing for a key saved under a secrets key since removed", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    const got = settings(await bare.get(BASE));
    expect(got.key).toMatchObject({ set: true, readable: false });
    expect(got.readiness).toEqual({ ready: false, reason: "secretsKeyMissing" });
    expect(detailPaths(await bare.get(`${BASE}/models`))).toEqual(["secretsKeyMissing"]);
  });
});

describe("AI settings: development-only non-EU routing (AI_ALLOW_NON_EU_ROUTING)", () => {
  // The same issuer and users as `h`, whose reset runs before every test.
  const hDev = aiHarness({ secretsKey, allowNonEuRouting: true, sharedIdp: () => h.idp() });
  beforeAll(() => hDev.start());
  afterAll(() => hDev.stop());

  it("reports nonEuRoutingAllowed, and false by default", async () => {
    expect(settings(await hDev.get(BASE)).nonEuRoutingAllowed).toBe(true);
    expect(settings(await h.get(BASE)).nonEuRoutingAllowed).toBe(false);
  });

  it("is ready with euOnly off and zero retention on; models, listing and the test work", async () => {
    await hDev.put(`${BASE}/key`, { key: KEY });
    const off = await hDev.patch(BASE, { euOnly: false });
    expect(settings(off)).toMatchObject({ euOnly: false, zeroRetention: true });
    expect((await hDev.get(`${BASE}/models`)).status).toBe(200);
    const save = await hDev.patch(BASE, {
      enabled: true,
      models: {
        conversation: MOCK_MODEL.id,
        controls: MOCK_MODEL.id,
        frameworks: MOCK_MODEL.id,
      },
    });
    expect(save.status).toBe(200);
    expect(settings(save).readiness).toEqual({ ready: true, reason: null });
    expect((await hDev.post(`${BASE}/test`)).body).toEqual({ ok: true, model: MOCK_MODEL.id });
  });

  it("still needs zero retention, whatever euOnly is", async () => {
    await hDev.put(`${BASE}/key`, { key: KEY });
    for (const euOnly of [true, false]) {
      await hDev.patch(BASE, { euOnly, zeroRetention: false });
      const list = await hDev.get(`${BASE}/models`);
      expect(list.status).toBe(409);
      expect(detailPaths(list)).toEqual(["aiUnavailable.privacyOff"]);
      const save = await hDev.patch(BASE, { models: { conversation: MOCK_MODEL.id } });
      expect(save.status).toBe(409);
      expect((await hDev.post(`${BASE}/test`)).body).toEqual({ ok: false, reason: "privacyOff" });
      expect(settings(await hDev.get(BASE)).readiness).toMatchObject({ reason: "privacyOff" });
    }
  });

  it("without the flag, euOnly off is still privacyOff", async () => {
    await h.put(`${BASE}/key`, { key: KEY });
    await h.patch(BASE, { euOnly: false });
    expect((await h.post(`${BASE}/test`)).body).toEqual({ ok: false, reason: "privacyOff" });
    expect(settings(await h.get(BASE)).readiness).toEqual({ ready: false, reason: "privacyOff" });
  });
});
