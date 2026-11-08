import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../src/load.js";
import {
  ANNEX_A_2022_REFS,
  EU_AI_ACT_CHAPTER_REFS,
  EU_AI_ACT_REFS,
  GDPR_REFS,
  NIS2_REFS,
  NIST_CSF_2_REFS,
  NIST_SP800_53_MODERATE_REFS,
} from "../src/references.js";
import { ControlFileSchema, type LibraryContent } from "../src/schema.js";
import { THEMES } from "../src/themes.js";
import { coverageGaps, validateLibrary } from "../src/validate.js";

const lib = loadLibrary();
const contentDir = fileURLToPath(new URL("../content/", import.meta.url));

const refsOf = (l: LibraryContent, versionKey: string) =>
  l.frameworks.find((f) => f.version.key === versionKey)?.requirements.map((r) => r.ref);

const SP800_53_FAMILIES = "AC AT AU CA CM CP IA IR MA MP PE PL PS RA SA SC SI SR".split(" ");

const allRequirements = (l: LibraryContent) => l.frameworks.flatMap((f) => f.requirements);

function contentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? contentFiles(path) : [path];
  });
}

describe("shipped library content", () => {
  it("the shipped library loads and passes validation", () => {
    expect(validateLibrary(lib)).toEqual([]);
  });

  it("ships the six framework versions with their keys, names and labels", () => {
    expect(
      lib.frameworks.map((f) => [
        f.version.key,
        f.framework.key,
        f.framework.name,
        f.framework.publisher,
        f.version.label,
      ]),
    ).toEqual([
      ["iso27001-2022", "iso27001", "ISO/IEC 27001", "ISO/IEC", "2022"],
      ["gdpr-2016-679", "gdpr", "GDPR", "European Union", "Regulation (EU) 2016/679"],
      ["nis2-2022-2555", "nis2", "NIS2", "European Union", "Directive (EU) 2022/2555"],
      ["nist-csf-2.0", "nist-csf", "NIST CSF", "NIST", "2.0"],
      ["nist-sp800-53-r5", "nist-sp800-53", "NIST SP 800-53", "NIST", "Rev. 5 (Moderate baseline)"],
      [
        "eu-ai-act-2024-1689",
        "eu-ai-act",
        "EU AI Act",
        "European Union",
        "Regulation (EU) 2024/1689",
      ],
    ]);
  });

  it("ISO 27001:2022 lists exactly the 93 Annex A reference points", () => {
    expect(refsOf(lib, "iso27001-2022")).toEqual([...ANNEX_A_2022_REFS]);
    expect(ANNEX_A_2022_REFS).toHaveLength(93);
  });

  it("GDPR lists the pinned articles", () => {
    expect(refsOf(lib, "gdpr-2016-679")).toEqual([...GDPR_REFS]);
  });

  it("NIS2 lists Art. 21(2)(a) to (j)", () => {
    expect(refsOf(lib, "nis2-2022-2555")).toEqual([...NIS2_REFS]);
  });

  it("NIST CSF 2.0 lists the 106 subcategories in Core order", () => {
    expect(refsOf(lib, "nist-csf-2.0")).toEqual([...NIST_CSF_2_REFS]);
    expect(NIST_CSF_2_REFS).toHaveLength(106);
    const perFunction = (fn: string) =>
      NIST_CSF_2_REFS.filter((r) => r.startsWith(`${fn}.`)).length;
    expect(["GV", "ID", "PR", "DE", "RS", "RC"].map(perFunction)).toEqual([31, 21, 22, 11, 13, 8]);
  });

  it("NIST CSF 2.0 groups subcategories by Function, then Category", () => {
    const file = lib.frameworks.find((f) => f.version.key === "nist-csf-2.0");
    const groups = file?.groups ?? [];
    expect(groups.filter((g) => g.parent === undefined).map((g) => [g.key, g.title])).toEqual([
      ["GV", "Govern"],
      ["ID", "Identify"],
      ["PR", "Protect"],
      ["DE", "Detect"],
      ["RS", "Respond"],
      ["RC", "Recover"],
    ]);
    const categories = groups.filter((g) => g.parent !== undefined);
    expect(categories).toHaveLength(22);
    for (const g of categories) expect(g.parent, g.key).toBe(g.key.split(".")[0]);
    for (const r of file?.requirements ?? []) expect(r.group, r.ref).toBe(r.ref.split("-")[0]);
  });

  it("NIST SP 800-53 lists the 177 Moderate baseline base controls in catalogue order", () => {
    expect(refsOf(lib, "nist-sp800-53-r5")).toEqual([...NIST_SP800_53_MODERATE_REFS]);
    expect(NIST_SP800_53_MODERATE_REFS).toHaveLength(177);
    expect(NIST_SP800_53_MODERATE_REFS.every((r) => /^[A-Z]{2}-\d+$/.test(r))).toBe(true);
    const perFamily = (family: string) =>
      NIST_SP800_53_MODERATE_REFS.filter((r) => r.startsWith(`${family}-`)).length;
    expect(SP800_53_FAMILIES.map(perFamily)).toEqual([
      17, 4, 11, 7, 12, 9, 10, 8, 6, 7, 16, 6, 9, 6, 11, 18, 11, 9,
    ]);
  });

  it("NIST SP 800-53 groups controls by family", () => {
    const file = lib.frameworks.find((f) => f.version.key === "nist-sp800-53-r5");
    expect(file?.groups?.map((g) => g.key)).toEqual(SP800_53_FAMILIES);
    expect(file?.groups?.find((g) => g.key === "AC")?.title).toBe("Access control");
    expect(file?.groups?.some((g) => g.parent !== undefined)).toBe(false);
    for (const r of file?.requirements ?? []) expect(r.group, r.ref).toBe(r.ref.split("-")[0]);
  });

  it("ISO 27001:2022 groups Annex A by its four themes", () => {
    const file = lib.frameworks.find((f) => f.version.key === "iso27001-2022");
    expect(file?.groups).toEqual([
      { key: "A.5", title: "Organisational controls" },
      { key: "A.6", title: "People controls" },
      { key: "A.7", title: "Physical controls" },
      { key: "A.8", title: "Technological controls" },
    ]);
    for (const r of file?.requirements ?? [])
      expect(r.group, r.ref).toBe(r.ref.split(".").slice(0, 2).join("."));
  });

  it("the EU AI Act lists the 36 obligation-bearing provisions in article order", () => {
    expect(refsOf(lib, "eu-ai-act-2024-1689")).toEqual([...EU_AI_ACT_REFS]);
    expect(EU_AI_ACT_REFS).toHaveLength(36);
  });

  it("the EU AI Act groups its provisions by Chapter", () => {
    const file = lib.frameworks.find((f) => f.version.key === "eu-ai-act-2024-1689");
    expect(file?.groups).toEqual([
      { key: "Chapter I", title: "General provisions" },
      { key: "Chapter II", title: "Prohibited AI practices" },
      { key: "Chapter III", title: "High-risk AI systems" },
      {
        key: "Chapter IV",
        title: "Transparency obligations for providers and deployers of certain AI systems",
      },
      {
        key: "Chapter IX",
        title: "Post-market monitoring, information sharing and market surveillance",
      },
    ]);
    const chapterOf = new Map(
      EU_AI_ACT_CHAPTER_REFS.flatMap(([chapter, refs]) => refs.map((r) => [r, chapter] as const)),
    );
    for (const r of file?.requirements ?? []) expect(r.group, r.ref).toBe(chapterOf.get(r.ref));
  });

  it("the AI governance file holds the AIG controls only, in their own category", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(contentDir, "controls/ai-governance.json"), "utf8"),
    );
    const { controls } = ControlFileSchema.parse(raw);
    expect(controls.map((c) => c.code)).toEqual(
      Array.from({ length: 11 }, (_, i) => `AIG-${String(i + 1).padStart(2, "0")}`),
    );
    for (const c of controls) expect(c.category, c.code).toBe("ai_governance");
  });

  it("every EU AI Act provision is mapped by at least one AIG control", () => {
    const byAig = new Set(
      lib.controls
        .filter((c) => c.code.startsWith("AIG-"))
        .flatMap((c) =>
          c.mappings.filter((m) => m.framework === "eu-ai-act-2024-1689").map((m) => m.ref),
        ),
    );
    expect(EU_AI_ACT_REFS.filter((r) => !byAig.has(r))).toEqual([]);
  });

  it("GDPR and NIS2 stay flat", () => {
    for (const key of ["gdpr-2016-679", "nis2-2022-2555"]) {
      const file = lib.frameworks.find((f) => f.version.key === key);
      expect(file?.groups, key).toBeUndefined();
      expect(file?.requirements.some((r) => r.group !== undefined)).toBe(false);
    }
  });

  it("requirement titles are own-words sentences", () => {
    for (const r of allRequirements(lib)) {
      const words = r.title.split(/\s+/).length;
      expect(r.title, r.ref).toMatch(/^[A-Z].*\.$/);
      expect(words, r.ref).toBeGreaterThanOrEqual(5);
      expect(words, r.ref).toBeLessThanOrEqual(16);
    }
  });

  it("framework summaries are at most 300 characters", () => {
    for (const f of lib.frameworks) {
      expect(f.framework.summary.length, f.framework.key).toBeLessThanOrEqual(300);
    }
  });

  it("every Annex A reference point A.5.1–A.8.34 is mapped at least once", () => {
    expect(coverageGaps(lib).filter((g) => g.framework === "iso27001-2022")).toEqual([]);
  });

  it("every requirement of every shipped framework is mapped at least once", () => {
    expect(coverageGaps(lib)).toEqual([]);
  });

  it("the themes partition Annex A: each reference point is assigned to exactly one theme", () => {
    const assigned = THEMES.flatMap((t) => t.iso);
    expect([...assigned].sort()).toEqual([...ANNEX_A_2022_REFS].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("the themes partition NIST CSF 2.0: each subcategory is assigned to exactly one theme", () => {
    const assigned = THEMES.flatMap((t) => t.nist);
    expect([...assigned].sort()).toEqual([...NIST_CSF_2_REFS].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("the themes partition NIST SP 800-53: each control is assigned to exactly one theme", () => {
    const assigned = THEMES.flatMap((t) => t.sp80053);
    expect([...assigned].sort()).toEqual([...NIST_SP800_53_MODERATE_REFS].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("every content file stays under 500 lines", () => {
    const files = contentFiles(contentDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8").split("\n").length, file).toBeLessThan(500);
    }
  });
});
