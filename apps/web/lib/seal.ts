import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Keys = { encryption: Buffer; lookup: Buffer };

/** Derives independent keys from SESSION_SECRET with HKDF-SHA256 (one per purpose). */
export function deriveKeys(secret: string): Keys {
  const derive = (info: string) =>
    Buffer.from(hkdfSync("sha256", secret, "isms-web", `isms-web/${info}/${VERSION}`, 32));
  return { encryption: derive("session-encryption"), lookup: derive("session-lookup") };
}

/**
 * AES-256-GCM with a random 96-bit IV. `aad` binds the ciphertext to its Redis key, so a
 * value copied to another key does not decrypt.
 */
export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Returns the plaintext, or null if the value is malformed, tampered or under another key. */
export function unseal(key: Buffer, sealed: string, aad: string): string | null {
  const [version, payload] = sealed.split(".");
  if (version !== VERSION || payload === undefined) return null;
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Keyed digest used in Redis keys, so Redis readers never see raw session ids. */
export function lookupDigest(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}
