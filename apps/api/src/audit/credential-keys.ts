const CREDENTIAL_WORDS = new Set([
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwd",
  "passphrase",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "apikey",
]);

const CREDENTIAL_PAIRS = new Set(
  ["api", "private", "secret", "access", "encryption", "signing"].map((w) => `${w} key`),
);

/** Splits a key into lower-case words at camelCase, `_`, `-`, `.` and digit boundaries. */
function words(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
}

/**
 * True for a key that names a credential. Matches whole words, so domain keys such as
 * `objectKey`, `sortKey` or `keyLast4` are kept while `apiKey`, `clientSecret` or `key` are not.
 */
export function isCredentialKey(key: string): boolean {
  const parts = words(key);
  if (parts.length === 1 && parts[0] === "key") return true;
  if (parts.some((w) => CREDENTIAL_WORDS.has(w))) return true;
  return parts.some((w, i) => {
    const next = parts[i + 1];
    return next !== undefined && CREDENTIAL_PAIRS.has(`${w} ${next}`);
  });
}
