import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, SecretUnreadableError } from "../src/secret-box.js";

const KEY = randomBytes(32);
const SECRET = "sk-or-v1-test-only-not-a-real-key-WXYZ";

describe("secret box", () => {
  it("round-trips a key and never stores the plaintext in the sealed bytes", () => {
    const sealed = sealSecret(SECRET, KEY);
    expect(sealed[0]).toBe(0x01);
    expect(sealed.length).toBe(1 + 12 + 16 + Buffer.byteLength(SECRET));
    expect(sealed.includes(Buffer.from(SECRET))).toBe(false);
    expect(sealed.toString("latin1")).not.toContain("WXYZ");
    expect(openSecret(sealed, KEY)).toBe(SECRET);
  });

  it("uses a fresh IV per seal", () => {
    expect(sealSecret(SECRET, KEY).equals(sealSecret(SECRET, KEY))).toBe(false);
  });

  it("a different key or a flipped tag byte throws SecretUnreadableError", () => {
    const sealed = sealSecret(SECRET, KEY);
    expect(() => openSecret(sealed, randomBytes(32))).toThrow(SecretUnreadableError);
    const flipped = Buffer.from(sealed);
    flipped[1 + 12] = (flipped[1 + 12] ?? 0) ^ 0xff;
    expect(() => openSecret(flipped, KEY)).toThrow(SecretUnreadableError);
  });

  it("an unknown format byte, a truncated box or a short key throws SecretUnreadableError", () => {
    const sealed = sealSecret(SECRET, KEY);
    const v2 = Buffer.from(sealed);
    v2[0] = 0x02;
    expect(() => openSecret(v2, KEY)).toThrow(SecretUnreadableError);
    expect(() => openSecret(sealed.subarray(0, 20), KEY)).toThrow(SecretUnreadableError);
    expect(() => openSecret(sealed, KEY.subarray(0, 16))).toThrow(SecretUnreadableError);
  });

  it("refuses to seal with a key that is not 32 bytes", () => {
    expect(() => sealSecret(SECRET, randomBytes(16))).toThrow(/32 bytes/);
  });

  it("never includes the secret in the error", () => {
    try {
      openSecret(sealSecret(SECRET, KEY), randomBytes(32));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(SECRET);
    }
  });
});
