import { Logger } from "@nestjs/common";
import { DomainError } from "@isms/domain";
import { SignJWT, base64url } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JwtVerifier } from "../../src/identity/index.js";
import { JwksServer, makeKey } from "./jwks-server.js";

const AUDIENCE = "isms-api";

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected verify() to reject");
}

async function expectUnauthenticated(promise: Promise<unknown>): Promise<void> {
  const err = await failure(promise);
  expect(err.code).toBe("UNAUTHENTICATED");
  expect(err.message).toBe("Sign-in required");
}

const unsigned = (payload: object): string =>
  `${base64url.encode(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url.encode(JSON.stringify(payload))}.`;

describe("JwtVerifier", () => {
  let idp: JwksServer;
  let verifier: JwtVerifier;
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(async () => {
    idp = await new JwksServer().start();
    idp.keys = [await makeKey("key-1")];
    verifier = new JwtVerifier({ issuer: idp.issuer, audience: AUDIENCE });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await idp.stop();
  });

  it("accepts a valid token", async () => {
    const authTime = now() - 60;
    const result = await verifier.verify(await idp.sign({ auth_time: authTime }));
    expect(result).toEqual({
      issuer: idp.issuer,
      subject: "subject-1",
      email: "user@example.test",
      emailVerified: true,
      name: "Test User",
      authTime,
      authTimeSource: "auth_time",
    });
  });

  it("accepts ES256 and an audience array containing the API", async () => {
    const ec = await makeKey("ec-1", "ES256");
    idp.keys.push(ec);
    const token = await idp.sign({ aud: [AUDIENCE, "account"] }, ec);
    expect((await verifier.verify(token)).subject).toBe("subject-1");
  });

  it("allows 30 s of clock skew", async () => {
    await expect(verifier.verify(await idp.sign({ exp: now() - 20 }))).resolves.toBeDefined();
    await expectUnauthenticated(verifier.verify(await idp.sign({ exp: now() - 40 })));
  });

  it("honours nbf with 30 s of clock skew", async () => {
    await expect(verifier.verify(await idp.sign({ nbf: now() + 20 }))).resolves.toBeDefined();
    await expectUnauthenticated(verifier.verify(await idp.sign({ nbf: now() + 120 })));
  });

  it("rejects an auth_time more than 30 s in the future", async () => {
    await expect(verifier.verify(await idp.sign({ auth_time: now() + 20 }))).resolves.toBeDefined();
    await expectUnauthenticated(verifier.verify(await idp.sign({ auth_time: now() + 120 })));
    await expectUnauthenticated(
      verifier.verify(await idp.sign({ auth_time: undefined, iat: now() + 120 })),
    );
  });

  it("falls back to preferred_username and iat", async () => {
    const iat = now() - 5;
    const result = await verifier.verify(
      await idp.sign({ name: undefined, preferred_username: "tuser", auth_time: undefined, iat }),
    );
    expect(result.name).toBe("tuser");
    expect(result.authTime).toBe(iat);
    // iat is renewed on every refresh, so it never proves a recent sign-in (R22).
    expect(result.authTimeSource).toBe("iat");
  });

  it.each([
    ["expired", { exp: 1_000_000 }],
    ["wrong issuer", { iss: "https://evil" }],
    ["wrong audience", { aud: "other" }],
    ["missing sub", { sub: undefined }],
    ["missing email", { email: undefined }],
    ["empty email", { email: "" }],
    ["non-boolean email_verified", { email_verified: "true" }],
    ["missing email_verified", { email_verified: undefined }],
    ["missing name and preferred_username", { name: undefined }],
    ["missing exp", { exp: undefined }],
    ["missing auth_time and iat", { auth_time: undefined, iat: undefined }],
  ])("rejects %s with UNAUTHENTICATED", async (_label, claims) => {
    await expectUnauthenticated(verifier.verify(await idp.sign(claims)));
  });

  describe("accepts only access tokens", () => {
    it.each(["ID", "id"])("rejects header typ %s (a Keycloak ID token)", async (typ) => {
      await expectUnauthenticated(verifier.verify(await idp.sign({}, undefined, typ)));
    });

    it("rejects a token carrying a nonce claim", async () => {
      await expectUnauthenticated(verifier.verify(await idp.sign({ nonce: "n-0S6_WzA2Mj" })));
      await expectUnauthenticated(verifier.verify(await idp.sign({ nonce: "" }, undefined, "JWT")));
    });

    it.each(["Bearer", "JWT", "at+jwt"])("accepts header typ %s by default", async (typ) => {
      await expect(verifier.verify(await idp.sign({}, undefined, typ))).resolves.toBeDefined();
    });

    it("accepts a token without a typ header by default", async () => {
      await expect(verifier.verify(await idp.sign())).resolves.toBeDefined();
    });

    it("enforces the configured access token typ case-insensitively", async () => {
      const strict = new JwtVerifier({
        issuer: idp.issuer,
        audience: AUDIENCE,
        accessTokenTyp: "at+jwt",
      });
      await expect(strict.verify(await idp.sign({}, undefined, "at+jwt"))).resolves.toBeDefined();
      await expect(strict.verify(await idp.sign({}, undefined, "AT+JWT"))).resolves.toBeDefined();
      await expectUnauthenticated(strict.verify(await idp.sign({}, undefined, "JWT")));
      await expectUnauthenticated(strict.verify(await idp.sign({}, undefined, "Bearer")));
      await expectUnauthenticated(strict.verify(await idp.sign()));
      await expectUnauthenticated(
        strict.verify(await idp.sign({ nonce: "n" }, undefined, "at+jwt")),
      );
    });
  });

  it("rejects a tampered signature", async () => {
    const [h, p, s = ""] = (await idp.sign()).split(".");
    const flipped = (s.startsWith("A") ? "B" : "A") + s.slice(1);
    await expectUnauthenticated(verifier.verify(`${String(h)}.${String(p)}.${flipped}`));
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await idp.sign()).split(".");
    const forged = base64url.encode(JSON.stringify({ sub: "admin", exp: now() + 300 }));
    await expectUnauthenticated(verifier.verify(`${String(h)}.${forged}.${String(s)}`));
  });

  it("rejects alg none (unsigned)", async () => {
    const token = unsigned({ iss: idp.issuer, aud: AUDIENCE, sub: "x", exp: now() + 300 });
    await expectUnauthenticated(verifier.verify(token));
    expect(idp.jwksHits).toBe(0);
  });

  it("rejects HS256 even when signed with the public key material", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(idp.keys[0]?.jwk));
    const token = await new SignJWT({ iss: idp.issuer, aud: AUDIENCE, sub: "x" })
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setExpirationTime("5m")
      .sign(secret);
    await expectUnauthenticated(verifier.verify(token));
  });

  it("rejects garbage and a token signed by an unknown key with a known kid", async () => {
    await expectUnauthenticated(verifier.verify("not-a-jwt"));
    const impostor = await makeKey("key-1");
    await expectUnauthenticated(verifier.verify(await idp.sign({}, impostor)));
  });

  it("refetches JWKS once for an unknown kid (key rotation)", async () => {
    await verifier.verify(await idp.sign());
    expect(idp.jwksHits).toBe(1);

    const rotated = await makeKey("key-2");
    idp.keys = [rotated];
    // jose refetches on an unknown kid only after its 30 s cooldown; fake only Date.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);

    await expect(verifier.verify(await idp.sign({}, rotated))).resolves.toBeDefined();
    expect(idp.jwksHits).toBe(2);
  });

  it("does not refetch JWKS for unknown kids within the cooldown", async () => {
    await verifier.verify(await idp.sign());
    const rotated = await makeKey("key-2");
    idp.keys = [rotated];
    for (let i = 0; i < 3; i++) {
      await expectUnauthenticated(verifier.verify(await idp.sign({}, rotated)));
    }
    expect(idp.jwksHits).toBe(1);
  });

  describe("maps key source failures to AUTH_UNAVAILABLE", () => {
    const expectUnavailable = async (promise: Promise<unknown>) => {
      const err = await failure(promise);
      expect(err.code).toBe("AUTH_UNAVAILABLE");
      expect(err.message).not.toMatch(/fetch|ECONN|JWKS|127\.0\.0\.1/i);
    };

    it("maps JWKS network failure to AUTH_UNAVAILABLE", async () => {
      const token = await idp.sign();
      await idp.stop();
      await expectUnavailable(verifier.verify(token));
    });

    it("when only the JWKS endpoint is unreachable", async () => {
      const broken = await new JwksServer({ jwksUri: "http://127.0.0.1:1/certs" }).start();
      broken.keys = [await makeKey("k")];
      try {
        const v = new JwtVerifier({ issuer: broken.issuer, audience: AUDIENCE });
        await expectUnavailable(v.verify(await broken.sign()));
      } finally {
        await broken.stop();
      }
    });

    it("when the JWKS endpoint answers non-200", async () => {
      idp.mode = "error";
      await expectUnavailable(verifier.verify(await idp.sign()));
    });

    it("when the JWKS fetch times out", async () => {
      idp.mode = "hang";
      const v = new JwtVerifier({ issuer: idp.issuer, audience: AUDIENCE, fetchTimeoutMs: 200 });
      await expectUnavailable(v.verify(await idp.sign()));
    });

    it("when discovery advertises a different issuer", async () => {
      const lying = await new JwksServer({ advertisedIssuer: "https://evil" }).start();
      lying.keys = [await makeKey("k")];
      try {
        const v = new JwtVerifier({ issuer: lying.issuer, audience: AUDIENCE });
        await expectUnavailable(v.verify(await lying.sign()));
      } finally {
        await lying.stop();
      }
    });

    it("recovers once the identity provider is back", async () => {
      idp.mode = "error";
      await expectUnavailable(verifier.verify(await idp.sign()));
      idp.mode = "ok";
      await expect(verifier.verify(await idp.sign())).resolves.toBeDefined();
    });
  });
});
