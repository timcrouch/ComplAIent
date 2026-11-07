import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(process.cwd(), "src");
const index = readFileSync(join(src, "index.ts"), "utf8");

/** Component modules the package index exports. */
const exported = [
  ...new Set([...index.matchAll(/from "\.\/(components\/[\w-]+)"/g)].map((m) => m[1] ?? "")),
];

/** Source without comments, so "document.body" in a doc comment is not usage. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CLIENT_ONLY = [
  /\buse(State|Effect|LayoutEffect|Ref|Callback|Memo|Id|Context|Reducer|Transition|SyncExternalStore|ImperativeHandle|DeferredValue|Optimistic|ActionState)\b/,
  /\b(document|window|navigator|localStorage|sessionStorage)\./,
];

describe("client directive", () => {
  it("finds the exported component modules", () => {
    expect(exported).toContain("components/command-palette");
    expect(exported.length).toBeGreaterThan(8);
  });

  it('every exported component using hooks or browser APIs starts with "use client"', () => {
    const missing = exported.filter((path) => {
      const text = readFileSync(join(src, `${path}.tsx`), "utf8");
      const clientOnly = CLIENT_ONLY.some((re) => re.test(code(text)));
      return clientOnly && !/^\s*["']use client["'];/.test(text);
    });
    expect(missing).toEqual([]);
  });
});
