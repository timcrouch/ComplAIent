import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .ts/.tsx file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

describe("dates", () => {
  it("pages and components format dates only through lib/dates (en-GB, app-wide)", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => sources(join(process.cwd(), dir)))
      .filter((file) => /format\.dateTime\(|toLocaleDateString\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(process.cwd().length + 1));
    expect(offenders).toEqual([]);
  });
});
