/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture indexes are known to exist */
import { describe, expect, it } from "vitest";
import { FIXTURE_LIBRARY } from "../src/testing.js";
import { ANNEX_A_2022_REFS, GDPR_REFS, NIS2_REFS, isoRange } from "../src/references.js";
import { coverageGaps, validateLibrary } from "../src/validate.js";
import type { LibraryContent } from "../src/schema.js";

const fresh = (): LibraryContent => structuredClone(FIXTURE_LIBRARY);

describe("validateLibrary", () => {
  it("accepts the fixture library", () => {
    expect(validateLibrary(FIXTURE_LIBRARY)).toEqual([]);
  });

  it.each<[string, (l: LibraryContent) => void]>([
    ["duplicate-control-code", (l) => void l.controls.push({ ...l.controls[0]! })],
    [
      "code-category-mismatch",
      (l) => {
        l.controls[0]!.category = "privacy";
      },
    ],
    [
      "unknown-framework-version",
      (l) => {
        l.controls[0]!.mappings[0]!.framework = "iso27001-2013";
      },
    ],
    [
      "unknown-requirement",
      (l) => {
        l.controls[0]!.mappings[0]!.ref = "A.9.9";
      },
    ],
    [
      "duplicate-mapping",
      (l) => void l.controls[0]!.mappings.push({ ...l.controls[0]!.mappings[0]! }),
    ],
    [
      "duplicate-requirement-ref",
      (l) => void l.frameworks[0]!.requirements.push({ ...l.frameworks[0]!.requirements[0]! }),
    ],
    [
      "duplicate-framework-version",
      (l) => void l.frameworks.push(structuredClone(l.frameworks[0]!)),
    ],
  ])("reports %s", (rule, mutate) => {
    const lib = fresh();
    mutate(lib);
    expect(validateLibrary(lib).map((i) => i.rule)).toContain(rule);
  });

  it("names the control and the reference in unknown-requirement", () => {
    const lib = fresh();
    lib.controls[0]!.mappings[0]!.ref = "A.9.9";
    const issue = validateLibrary(lib).find((i) => i.rule === "unknown-requirement");
    expect(issue?.message).toContain("GOV-01");
    expect(issue?.message).toContain("iso27001-2022 A.9.9");
  });
});

/** A two-level framework: two top-level groups, three leaf groups. */
function twoLevel(): LibraryContent {
  const lib = fresh();
  lib.frameworks.push({
    framework: { key: "csf", name: "CSF", publisher: "P", summary: "S" },
    version: { key: "csf-2", label: "2" },
    groups: [
      { key: "GV", title: "Govern" },
      { key: "GV.OC", title: "Organisational context", parent: "GV" },
      { key: "GV.RM", title: "Risk management strategy", parent: "GV" },
      { key: "ID", title: "Identify" },
      { key: "ID.AM", title: "Asset management", parent: "ID" },
    ],
    requirements: [
      { ref: "GV.OC-01", title: "t", group: "GV.OC" },
      { ref: "GV.OC-02", title: "t", group: "GV.OC" },
      { ref: "GV.RM-01", title: "t", group: "GV.RM" },
      { ref: "ID.AM-01", title: "t", group: "ID.AM" },
    ],
  });
  lib.controls[0]!.mappings.push(
    ...["GV.OC-01", "GV.OC-02", "GV.RM-01", "ID.AM-01"].map((ref) => ({ framework: "csf-2", ref })),
  );
  return lib;
}

const csf = (l: LibraryContent) => l.frameworks.find((f) => f.version.key === "csf-2")!;

describe("validateLibrary: requirement groups", () => {
  it("accepts one-level, two-level and flat frameworks side by side", () => {
    expect(validateLibrary(twoLevel())).toEqual([]);
  });

  it.each<[string, (l: LibraryContent) => void]>([
    ["duplicate-group-key", (l) => void csf(l).groups!.push({ key: "ID", title: "Again" })],
    [
      "invalid-group-parent",
      (l) => {
        csf(l).groups![1]!.parent = "XX";
      },
    ],
    [
      "invalid-group-parent",
      (l) => {
        // A parent must come before its children.
        const groups = csf(l).groups!;
        groups.splice(3, 2, { key: "ID.AM", title: "Asset management", parent: "ID" });
        groups.push({ key: "ID", title: "Identify" });
      },
    ],
    [
      "group-too-deep",
      (l) => {
        csf(l).groups!.push({ key: "GV.OC.X", title: "Too deep", parent: "GV.OC" });
      },
    ],
    [
      "missing-requirement-group",
      (l) => {
        delete csf(l).requirements[0]!.group;
      },
    ],
    [
      "unexpected-requirement-group",
      (l) => {
        l.frameworks[1]!.requirements[0]!.group = "X";
      },
    ],
    [
      "unknown-requirement-group",
      (l) => {
        csf(l).requirements[0]!.group = "PR.AA";
      },
    ],
    [
      "requirement-group-not-leaf",
      (l) => {
        csf(l).requirements[0]!.group = "GV";
      },
    ],
    [
      "requirement-group-out-of-order",
      (l) => {
        // GV.OC, GV.RM, GV.OC: not contiguous.
        const reqs = csf(l).requirements;
        [reqs[1], reqs[2]] = [reqs[2]!, reqs[1]!];
      },
    ],
    [
      "requirement-group-out-of-order",
      (l) => {
        // Contiguous but in a different order from the groups.
        csf(l).requirements.reverse();
      },
    ],
    [
      "empty-group",
      (l) => {
        csf(l).groups!.push({ key: "PR", title: "Protect" });
      },
    ],
  ])("reports %s", (rule, mutate) => {
    const lib = twoLevel();
    mutate(lib);
    expect(validateLibrary(lib).map((i) => i.rule)).toContain(rule);
  });

  it("names the framework version and the requirement", () => {
    const lib = twoLevel();
    csf(lib).requirements[0]!.group = "PR.AA";
    const issue = validateLibrary(lib).find((i) => i.rule === "unknown-requirement-group");
    expect(issue?.message).toContain("csf-2");
    expect(issue?.message).toContain("GV.OC-01");
    expect(issue?.message).toContain("PR.AA");
  });
});

describe("coverageGaps", () => {
  it("lists unmapped requirements", () => {
    const lib = fresh();
    lib.controls = lib.controls.filter((c) => c.code !== "GOV-01");
    expect(coverageGaps(lib)).toEqual([{ framework: "iso27001-2022", ref: "A.5.1" }]);
  });
  it("is empty for the fixture", () => {
    expect(coverageGaps(FIXTURE_LIBRARY)).toEqual([]);
  });
});

describe("references", () => {
  it("ANNEX_A_2022_REFS has 93 entries from A.5.1 to A.8.34", () => {
    expect(ANNEX_A_2022_REFS).toHaveLength(93);
    expect(ANNEX_A_2022_REFS[0]).toBe("A.5.1");
    expect(ANNEX_A_2022_REFS.at(-1)).toBe("A.8.34");
    expect(ANNEX_A_2022_REFS).toContain("A.6.8");
    expect(ANNEX_A_2022_REFS).toContain("A.7.14");
  });
  it("has 16 GDPR and 10 NIS2 references", () => {
    expect(GDPR_REFS).toHaveLength(16);
    expect(NIS2_REFS).toEqual([
      "Art. 21(2)(a)",
      "Art. 21(2)(b)",
      "Art. 21(2)(c)",
      "Art. 21(2)(d)",
      "Art. 21(2)(e)",
      "Art. 21(2)(f)",
      "Art. 21(2)(g)",
      "Art. 21(2)(h)",
      "Art. 21(2)(i)",
      "Art. 21(2)(j)",
    ]);
  });
  it("isoRange is inclusive within one clause", () => {
    expect(isoRange("A.5.3", "A.5.5")).toEqual(["A.5.3", "A.5.4", "A.5.5"]);
    expect(isoRange("A.8.13", "A.8.13")).toEqual(["A.8.13"]);
    expect(() => isoRange("A.5.3", "A.6.5")).toThrow();
    expect(() => isoRange("A.5.9", "A.5.3")).toThrow();
  });
});
