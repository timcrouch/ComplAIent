/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture indexes are known to exist */
import { describe, expect, it } from "vitest";
import {
  ControlFileSchema,
  FrameworkFileSchema,
  ManifestSchema,
  MappingFileSchema,
} from "../src/schema.js";
import { FIXTURE_LIBRARY } from "../src/testing.js";
import { CONTROL_CODE_PREFIX_CATEGORY } from "@isms/domain";

const fw = () => ({
  framework: { key: "gdpr", name: "GDPR", publisher: "EU", summary: "s" },
  version: { key: "gdpr-2016-679", label: "2016/679" },
  requirements: [{ ref: "Art. 32", title: "t" }],
});

describe("schemas", () => {
  it("accepts a framework file", () => {
    expect(FrameworkFileSchema.safeParse(fw()).success).toBe(true);
  });
  it("rejects a fullText field in a framework file", () => {
    const bad = fw();
    (bad.requirements[0] as Record<string, unknown>).fullText = "x";
    expect(FrameworkFileSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts groups and a requirement's group, and rejects unknown group fields", () => {
    const grouped = {
      ...fw(),
      groups: [{ key: "A.5", title: "Organisational controls" }],
      requirements: [{ ref: "A.5.1", title: "t", group: "A.5" }],
    };
    expect(FrameworkFileSchema.safeParse(grouped).success).toBe(true);
    const child = { ...grouped, groups: [{ key: "A.5", title: "t", parent: "A" }] };
    expect(FrameworkFileSchema.safeParse(child).success).toBe(true);
    const extra = { ...grouped, groups: [{ key: "A.5", title: "t", sortOrder: 1 }] };
    expect(FrameworkFileSchema.safeParse(extra).success).toBe(false);
    expect(FrameworkFileSchema.safeParse({ ...grouped, groups: [] }).success).toBe(false);
  });
  it("rejects a framework file without requirements", () => {
    expect(FrameworkFileSchema.safeParse({ ...fw(), requirements: [] }).success).toBe(false);
  });
  it("rejects a control without mappings", () => {
    const control = { ...FIXTURE_LIBRARY.controls[0]!, mappings: [] };
    expect(ControlFileSchema.safeParse({ controls: [control] }).success).toBe(false);
  });
  it("rejects a malformed code and an unknown category", () => {
    const c = FIXTURE_LIBRARY.controls[0]!;
    expect(ControlFileSchema.safeParse({ controls: [{ ...c, code: "GOV-1" }] }).success).toBe(
      false,
    );
    expect(ControlFileSchema.safeParse({ controls: [{ ...c, category: "other" }] }).success).toBe(
      false,
    );
  });
  it("checks the manifest version format", () => {
    const ok = { libraryVersion: "2026.11.0", frameworks: [], controls: [] };
    expect(ManifestSchema.safeParse(ok).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...ok, libraryVersion: "2026.1" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it("accepts every domain prefix with its category", () => {
    const c = FIXTURE_LIBRARY.controls[0]!;
    for (const [prefix, category] of Object.entries(CONTROL_CODE_PREFIX_CATEGORY)) {
      const parsed = ControlFileSchema.safeParse({
        controls: [{ ...c, code: `${prefix}-01`, category }],
      });
      expect(parsed.success).toBe(true);
    }
  });
  it("the manifest may list mapping files, and a mapping file names control and ref", () => {
    const ok = { libraryVersion: "2026.11.0", frameworks: [], controls: [], mappings: ["m.json"] };
    expect(ManifestSchema.safeParse(ok).success).toBe(true);
    const file = { framework: "gdpr-2016-679", mappings: [{ control: "GOV-01", ref: "Art. 32" }] };
    expect(MappingFileSchema.safeParse(file).success).toBe(true);
    expect(
      MappingFileSchema.safeParse({
        ...file,
        mappings: [{ control: "GOV-1", ref: "Art. 32" }],
      }).success,
    ).toBe(false);
  });
});
