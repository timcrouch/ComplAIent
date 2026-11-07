const MAX_LENGTH = 2048;
// Control characters (C0, DEL, C1) and backslashes, which browsers may treat as "/".
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\\]/;
const PROBE_ORIGIN = "http://return-to.invalid";

function isSafePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || FORBIDDEN.test(value)) return false;
  // Never send a user back into the sign-in flow: that is how redirect loops start.
  if (value === "/auth" || /^\/auth[/?#]/.test(value)) return false;
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

const MAX_DECODE_ROUNDS = 3;
/** A "%" that does not start a valid escape; encoded so later decode rounds cannot throw. */
const STRAY_PERCENT = /%(?![0-9A-Fa-f]{2})/g;

/**
 * Allows only same-origin relative paths ("/x"). Rejects protocol-relative ("//x"), absolute
 * URLs, backslashes, control characters, leading whitespace and /auth/*. The checks run on the
 * value and on each percent-decoded form (up to three rounds), so "/%2F%2Fevil.com" and
 * "/%252F%252Fevil.com" are rejected too. The raw value must decode strictly; later rounds
 * decode leniently (a stray "%" is kept literally), so a trailing "%25" cannot end the
 * checks early. A value still changing after three rounds is rejected. Everything else
 * becomes "/".
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH) return "/";
  let current = value;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round++) {
    if (!isSafePath(current)) return "/";
    let next: string;
    try {
      next = decodeURIComponent(round === 0 ? current : current.replace(STRAY_PERCENT, "%25"));
    } catch {
      return "/"; // malformed escape or invalid UTF-8
    }
    if (next === current) return value;
    if (round === MAX_DECODE_ROUNDS) return "/"; // still encoded after 3 rounds: suspicious
    current = next;
  }
  return "/";
}
