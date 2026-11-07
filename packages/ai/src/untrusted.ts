const TAG = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Puts untrusted text (user input, retrieved content) inside `<tag>…</tag>` for a user-role
 * message. `&`, `<` and `>` are escaped first, so the text can neither close the delimiter nor
 * open another one, however it nests them. Tasks 8 and 12 use this for every untrusted text.
 */
export function wrapUntrusted(tag: string, text: string): string {
  if (!TAG.test(tag)) throw new Error("wrapUntrusted: the tag must be a plain lower-case name");
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<${tag}>\n${escaped}\n</${tag}>`;
}
