const MAX_NAME_LENGTH = 200;
/** The longest tail kept as an extension when a name is cut, dot included (".xlsx"). */
const MAX_EXTENSION_LENGTH = 16;

// Character classes as regex source, as in the contracts' `text.ts`.
/** Tabs, line breaks and other whitespace controls; they become one space. */
const WHITESPACE_CONTROL = new RegExp("[\\t\\n\\v\\f\\r\\u0085]", "g");
const CONTROL = "\\x00-\\x1f\\x7f-\\x9f";
/** Soft hyphen, zero-width space, bidi controls, BOM: the set `text.ts` refuses. */
const INVISIBLE = "\\u00ad\\u061c\\u180e\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff";
const CONTROL_OR_INVISIBLE = new RegExp(`[${CONTROL}${INVISIBLE}]`, "g");

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
function cut(value: string, max: number): string {
  const head = value.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/**
 * The name evidence is stored and downloaded under: the base name after the last `/` or
 * `\`, without control or bidi characters, whitespace collapsed, at most 200 characters with
 * the extension kept. An empty result is "evidence".
 */
export function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(WHITESPACE_CONTROL, " ")
    .replace(CONTROL_OR_INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return "evidence";
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension =
    dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH ? cleaned.slice(dot) : "";
  return cut(cleaned, MAX_NAME_LENGTH - extension.length) + extension;
}

/** RFC 5987 encoding: encodeURIComponent leaves ' ( ) * as they are. */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Always an attachment, never shown inline (P3-R12). */
export function contentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
