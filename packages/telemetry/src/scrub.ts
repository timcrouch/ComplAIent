export const REDACTED = "[Redacted]";
const MAX_DEPTH = 10;

/** Keys whose values are credentials, matched case-insensitively on the key name only. */
const SENSITIVE_KEY = /token|secret|passw(?:or)?d|authorization|cookie|api[-_]?key|key$/i;

export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key);

type Seen = WeakSet<object>;

function scrubValue(value: unknown, depth: number, ancestors: Seen): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Date || ArrayBuffer.isView(value)) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (ancestors.has(value)) return "[Circular]";

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1, ancestors));
    const out: Record<string, unknown> = {};
    if (value instanceof Error) {
      out["type"] = value.constructor.name;
      out["message"] = value.message;
      out["stack"] = value.stack;
      if ("cause" in value) out["cause"] = scrubValue(value.cause, depth + 1, ancestors);
    }
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(inner, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Returns a copy of `value` with credential-bearing keys replaced, at any depth up to a cap
 * (deeper subtrees are redacted whole). Cycles become "[Circular]". Errors are flattened to
 * plain objects so their own properties and `cause` chain are scrubbed too. Secrets inside
 * string values are out of scope.
 */
export function scrub(value: unknown): unknown {
  return scrubValue(value, 0, new WeakSet());
}
