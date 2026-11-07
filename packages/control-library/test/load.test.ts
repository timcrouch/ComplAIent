/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture indexes are known to exist */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_LIBRARY } from "../src/testing.js";
import { LibraryError, loadLibrary } from "../src/load.js";

function dir(files: Record<string, unknown>): URL {
  const root = mkdtempSync(join(tmpdir(), "lib-"));
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  }
  return pathToFileURL(root + "/");
}

const manifest = (controls: string[], frameworks: string[], mappings?: string[]) => ({
  libraryVersion: "2026.11.0",
  frameworks,
  controls,
  ...(mappings ? { mappings } : {}),
});

const gdpr = FIXTURE_LIBRARY.frameworks[1]!;

describe("loadLibrary", () => {
  it("loads the shipped content", () => {
    const lib = loadLibrary();
    expect(lib.libraryVersion).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it("loads frameworks and controls named by the manifest", () => {
    const url = dir({
      "manifest.json": manifest(["controls/a.json"], ["frameworks/f0.json", "frameworks/f1.json"]),
      "frameworks/f0.json": {
        framework: {
          key: "iso27001",
          name: "ISO/IEC 27001",
          publisher: "ISO",
          summary: "s",
        },
        version: { key: "iso27001-2022", label: "2022" },
        requirements: FIXTURE_LIBRARY.frameworks[0]!.requirements,
      },
      "frameworks/f1.json": FIXTURE_LIBRARY.frameworks[1],
      "controls/a.json": { controls: FIXTURE_LIBRARY.controls },
    });
    const lib = loadLibrary(url);
    expect(lib.frameworks).toHaveLength(2);
    expect(lib.controls).toHaveLength(3);
    expect(lib.libraryVersion).toBe("2026.11.0");
  });

  it("names the file and the path of a schema error", () => {
    const url = dir({
      "manifest.json": manifest(["controls/bad.json"], []),
      "controls/bad.json": {
        controls: [{ ...FIXTURE_LIBRARY.controls[0], code: "XX-1" }],
      },
    });
    expect(() => loadLibrary(url)).toThrow(LibraryError);
    expect(() => loadLibrary(url)).toThrow(/controls\/bad\.json: controls\.0\.code/);
  });

  it("names the file for invalid JSON and missing files", () => {
    expect(() =>
      loadLibrary(
        dir({
          "manifest.json": manifest(["controls/x.json"], []),
          "controls/x.json": "{",
        }),
      ),
    ).toThrow(/controls\/x\.json: /);
    expect(() =>
      loadLibrary(dir({ "manifest.json": manifest(["controls/none.json"], []) })),
    ).toThrow(/controls\/none\.json: /);
  });

  it("appends the entries of a mapping file to the named controls", () => {
    const url = dir({
      "manifest.json": manifest(["controls/a.json"], ["frameworks/g.json"], ["mappings/g.json"]),
      "frameworks/g.json": gdpr,
      "controls/a.json": { controls: FIXTURE_LIBRARY.controls },
      "mappings/g.json": {
        framework: "gdpr-2016-679",
        mappings: [{ control: "GOV-01", ref: "Art. 32" }],
      },
    });
    const gov = loadLibrary(url).controls.find((c) => c.code === "GOV-01");
    expect(gov?.mappings).toEqual([
      ...FIXTURE_LIBRARY.controls[0]!.mappings,
      { framework: "gdpr-2016-679", ref: "Art. 32" },
    ]);
  });

  it("refuses a mapping to an unknown control and names the file", () => {
    const url = dir({
      "manifest.json": manifest(["controls/a.json"], [], ["mappings/g.json"]),
      "controls/a.json": { controls: FIXTURE_LIBRARY.controls },
      "mappings/g.json": {
        framework: "gdpr-2016-679",
        mappings: [{ control: "GOV-99", ref: "x" }],
      },
    });
    expect(() => loadLibrary(url)).toThrow(LibraryError);
    expect(() => loadLibrary(url)).toThrow(
      /mappings\/g\.json: mappings\.0\.control: unknown control GOV-99/,
    );
  });
});
