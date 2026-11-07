import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../src/load.js";
import { ControlFileSchema, ManifestSchema, type LibraryContent } from "../src/schema.js";
import { THEMES, type Theme } from "../src/themes.js";

const lib = loadLibrary();
const contentDir = new URL("../content/", import.meta.url);
const readContent = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(file, contentDir), "utf8"));
const manifest = ManifestSchema.parse(readContent("manifest.json"));

const prefixOf = (code: string) => code.split("-")[0] ?? "";

/** "<versionKey> <ref>" for every mapping of the theme's controls, selected by code prefix. */
const mappedRefs = (l: LibraryContent, theme: Theme): string[] => [
  ...new Set(
    l.controls
      .filter((c) => theme.prefixes.includes(prefixOf(c.code)))
      .flatMap((c) => c.mappings.map((m) => `${m.framework} ${m.ref}`)),
  ),
];

describe("control themes", () => {
  it.each(THEMES.map((t) => [t.key, t] as const))(
    "theme %s covers its assigned references",
    (_key, theme) => {
      const mapped = mappedRefs(lib, theme);
      for (const ref of theme.iso) expect(mapped).toContain(`iso27001-2022 ${ref}`);
      for (const ref of theme.gdpr) expect(mapped).toContain(`gdpr-2016-679 ${ref}`);
      for (const ref of theme.nis2) expect(mapped).toContain(`nis2-2022-2555 ${ref}`);
      for (const ref of theme.nist) expect(mapped).toContain(`nist-csf-2.0 ${ref}`);
      for (const ref of theme.sp80053) expect(mapped).toContain(`nist-sp800-53-r5 ${ref}`);
    },
  );

  it.each(THEMES.map((t) => [t.key, t] as const))(
    "theme %s files are in the manifest, hold only its prefixes and at most 20 controls each",
    (_key, theme) => {
      for (const file of theme.files) {
        expect(manifest.controls).toContain(file);
        const { controls } = ControlFileSchema.parse(readContent(file));
        expect(controls.length, file).toBeGreaterThan(0);
        expect(controls.length, file).toBeLessThanOrEqual(20);
        for (const c of controls) expect(theme.prefixes, c.code).toContain(prefixOf(c.code));
      }
    },
  );

  it("control text follows the authoring rules", () => {
    expect(lib.controls.length).toBeGreaterThan(0);
    for (const c of lib.controls) {
      const words = c.title.trim().split(/\s+/).length;
      expect(words, c.code).toBeGreaterThanOrEqual(3);
      expect(words, c.code).toBeLessThanOrEqual(12);
      expect(c.title, c.code).not.toMatch(/\.$/);
      expect(c.description.length, c.code).toBeLessThanOrEqual(400);
      const sentences = c.description.split(/(?<=[.!?])\s+/).length;
      expect(sentences, c.code).toBeGreaterThanOrEqual(1);
      expect(sentences, c.code).toBeLessThanOrEqual(3);
      expect(c.guidance.length, c.code).toBeGreaterThanOrEqual(2);
      expect(c.guidance.length, c.code).toBeLessThanOrEqual(6);
      for (const step of c.guidance) expect(step.length, c.code).toBeLessThanOrEqual(200);
    }
  });

  it("control codes are numbered from 01 without gaps per prefix", () => {
    expect(lib.controls.length).toBeGreaterThan(0);
    const byPrefix = new Map<string, number[]>();
    for (const c of lib.controls) {
      const numbers = byPrefix.get(prefixOf(c.code)) ?? [];
      numbers.push(Number(c.code.split("-")[1]));
      byPrefix.set(prefixOf(c.code), numbers);
    }
    for (const [prefix, numbers] of byPrefix) {
      const sorted = [...numbers].sort((a, b) => a - b);
      expect(sorted, prefix).toEqual(Array.from({ length: sorted.length }, (_, i) => i + 1));
    }
  });
});
