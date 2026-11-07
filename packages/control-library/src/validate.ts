import { CONTROL_CODE_PREFIX_CATEGORY } from "@isms/domain";
import { validateGroups, type GroupRule } from "./groups.js";
import type { LibraryContent } from "./schema.js";

export type LibraryRule =
  | GroupRule
  | "duplicate-framework-version"
  | "duplicate-requirement-ref"
  | "duplicate-control-code"
  | "code-category-mismatch"
  | "unknown-framework-version"
  | "unknown-requirement"
  | "duplicate-mapping";

export type LibraryIssue = { rule: LibraryRule; message: string };

export function validateLibrary(lib: LibraryContent): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const add = (rule: LibraryRule, message: string) => issues.push({ rule, message });

  const refsByVersion = new Map<string, Set<string>>();
  for (const file of lib.frameworks) {
    const key = file.version.key;
    if (refsByVersion.has(key))
      add("duplicate-framework-version", `Framework version ${key} appears twice`);
    const refs = refsByVersion.get(key) ?? new Set<string>();
    for (const { ref } of file.requirements) {
      if (refs.has(ref)) add("duplicate-requirement-ref", `${key} lists requirement ${ref} twice`);
      refs.add(ref);
    }
    refsByVersion.set(key, refs);
    validateGroups(file, add);
  }

  const codes = new Set<string>();
  for (const control of lib.controls) {
    if (codes.has(control.code))
      add("duplicate-control-code", `Control ${control.code} appears twice`);
    codes.add(control.code);

    const prefix = control.code.split("-")[0] as keyof typeof CONTROL_CODE_PREFIX_CATEGORY;
    const expected = CONTROL_CODE_PREFIX_CATEGORY[prefix];
    if (expected !== control.category) {
      add(
        "code-category-mismatch",
        `Control ${control.code} is in category ${control.category}, but its prefix means ${expected}`,
      );
    }

    const seen = new Set<string>();
    for (const { framework, ref } of control.mappings) {
      const refs = refsByVersion.get(framework);
      if (!refs) {
        add(
          "unknown-framework-version",
          `Control ${control.code} maps to unknown framework version ${framework}`,
        );
        continue;
      }
      if (!refs.has(ref)) {
        add(
          "unknown-requirement",
          `Control ${control.code} maps to unknown requirement ${framework} ${ref}`,
        );
      }
      const id = `${framework} ${ref}`;
      if (seen.has(id)) add("duplicate-mapping", `Control ${control.code} maps to ${id} twice`);
      seen.add(id);
    }
  }
  return issues;
}

/** Requirements that no control maps to. */
export function coverageGaps(lib: LibraryContent): { framework: string; ref: string }[] {
  const mapped = new Set(
    lib.controls.flatMap((c) => c.mappings.map((m) => `${m.framework}\u0000${m.ref}`)),
  );
  return lib.frameworks.flatMap((file) =>
    file.requirements
      .filter((r) => !mapped.has(`${file.version.key}\u0000${r.ref}`))
      .map((r) => ({ framework: file.version.key, ref: r.ref })),
  );
}
