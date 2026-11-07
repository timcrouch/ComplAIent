import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../messages/index";

const dir = join(process.cwd(), "messages/en");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

function paths(value: unknown, prefix: string[] = []): string[] {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => paths(v, [...prefix, k]));
  }
  return [prefix.join(".")];
}

function canonical(value: unknown): unknown {
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** Only the given dot paths of `value`, as a nested object. */
function pick(value: unknown, keep: readonly string[]): unknown {
  const out: Record<string, unknown> = {};
  for (const path of keep) {
    const parts = path.split(".");
    let source: unknown = value;
    let target = out;
    parts.forEach((part, i) => {
      source = (source as Record<string, unknown>)[part];
      if (i === parts.length - 1) target[part] = source;
      else target = (target[part] ??= {}) as Record<string, unknown>;
    });
  }
  return out;
}

describe("message files", () => {
  it("every message file is under 500 lines and namespaces do not collide", () => {
    expect(files.sort()).toEqual(
      expect.arrayContaining([
        "common.json",
        "home.json",
        "library.json",
        "settings.json",
        "setup.json",
        "shell.json",
      ]),
    );
    const seen = new Map<string, string>();
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text.split("\n").length, file).toBeLessThan(500);
      for (const key of Object.keys(JSON.parse(text) as object)) {
        expect(seen.get(key), `${key} in ${file} collides`).toBeUndefined();
        seen.set(key, file);
      }
    }
  });

  it("no message file repeats a key in the same object (JSON would keep only the last)", () => {
    const TOKEN = /"(?:[^"\\]|\\.)*"|[{}[\]:,]|[^\s{}[\]:,"]+/g;
    for (const file of files) {
      const tokens = readFileSync(join(dir, file), "utf8").match(TOKEN) ?? [];
      const stack: (Set<string> | null)[] = [];
      tokens.forEach((token, i) => {
        if (token === "{") stack.push(new Set());
        else if (token === "[") stack.push(null);
        else if (token === "}" || token === "]") stack.pop();
        else if (token.startsWith('"') && tokens[i + 1] === ":") {
          const keys = stack.at(-1);
          expect(keys?.has(token), `${token} repeated in ${file}`).toBe(false);
          keys?.add(token);
        }
      });
    }
  });

  it("every message of the old en.json is still there, unchanged", () => {
    // Later plans add keys; the Plan 2 copy (pinned by its key paths and hash) must not drift.
    // Deliberately changed once: app.name, app.tagline, app.description and home.eyebrow for the ComplAIent rebrand.
    const expected = readFileSync(join(process.cwd(), "test/fixtures/en-key-paths.txt"), "utf8")
      .trim()
      .split("\n");
    expect(paths(messages)).toEqual(expect.arrayContaining(expected));
    const hash = createHash("sha256")
      .update(JSON.stringify(canonical(pick(messages, expected))))
      .digest("hex");
    expect(hash).toBe("81dd9d6b22ee96da772a9aa9c32ac53de2890895666f8cff9bf9dee39251e8f2");
  });
});
