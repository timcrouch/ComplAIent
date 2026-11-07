import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Format byte of the current sealed layout: `0x01 | iv(12) | tag(16) | ciphertext`. */
const FORMAT_V1 = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Binds a sealed value to its purpose, so a box sealed for something else does not open here. */
const AAD = Buffer.from("isms:ai-settings:openrouter-key:v1", "utf8");

/** The sealed value cannot be opened: wrong key, tampered bytes or unknown format. Carries no detail. */
export class SecretUnreadableError extends Error {
  constructor() {
    super("The sealed secret cannot be read");
    this.name = "SecretUnreadableError";
  }
}

/** Seals `plaintext` with AES-256-GCM under `key` (32 bytes, from AI_SECRETS_KEY). */
export function sealSecret(plaintext: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new Error("The secrets key must be 32 bytes");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_V1]), iv, cipher.getAuthTag(), ciphertext]);
}

/** Opens a value sealed by `sealSecret`; throws `SecretUnreadableError` on any failure. */
export function openSecret(sealed: Buffer, key: Buffer): string {
  if (
    key.length !== KEY_BYTES ||
    sealed.length < 1 + IV_BYTES + TAG_BYTES ||
    sealed[0] !== FORMAT_V1
  ) {
    throw new SecretUnreadableError();
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretUnreadableError();
  }
}
