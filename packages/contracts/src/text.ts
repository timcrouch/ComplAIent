import { z } from "zod";
import "./zod.js";

// Character classes as regex source. No `u` flag: the OpenAPI generator would print it into
// the pattern. Postgres `text` cannot store NUL at all, so it must never reach the database.
const CONTROL = "\\x00-\\x1f\\x7f-\\x9f";
const CONTROL_EXCEPT_TAB_AND_LINE_BREAKS = "\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f";
/** Invisible format characters (soft hyphen, zero-width space, bidi controls, BOM). The
 * zero-width non-joiner and joiner (U+200C, U+200D) are allowed: Persian spelling and emoji
 * sequences such as 👩‍💻 need them. */
const INVISIBLE = "\\u00ad\\u061c\\u180e\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff";

const PATTERNS = {
  /** Plain spaces only, for names the database keys with `lower(btrim(name))`: `btrim`
   * strips spaces but not tabs, line breaks or other Unicode spaces. */
  name: new RegExp(`^(?:[^\\s${CONTROL}${INVISIBLE}]| )*$`),
  /** One line of text. */
  line: new RegExp(`^[^${CONTROL}${INVISIBLE}]*$`),
  /** Text that may span lines: tabs and line breaks are allowed. */
  multiline: new RegExp(`^[^${CONTROL_EXCEPT_TAB_AND_LINE_BREAKS}${INVISIBLE}]*$`),
} as const;

export type TextKind = keyof typeof PATTERNS;

/**
 * A required, trimmed free-text field of 1 to `max` characters that refuses control and
 * invisible characters. The pattern is checked before trimming, so a trailing tab in a
 * name is refused (400) rather than silently removed.
 */
export function text(max: number, kind: TextKind = "line") {
  return z.string().regex(PATTERNS[kind]).trim().min(1).max(max);
}

/** Like `text`, but an empty (or all-space) value is allowed and saved as "". */
export function textOrEmpty(max: number, kind: TextKind = "line") {
  return z.string().regex(PATTERNS[kind]).trim().max(max);
}
