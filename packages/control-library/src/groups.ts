import type { FrameworkFile } from "./schema.js";

export type GroupRule =
  | "duplicate-group-key"
  | "invalid-group-parent"
  | "group-too-deep"
  | "missing-requirement-group"
  | "unexpected-requirement-group"
  | "unknown-requirement-group"
  | "requirement-group-not-leaf"
  | "requirement-group-out-of-order"
  | "empty-group";

/**
 * Groups are at most two levels, listed in display order with each parent before its children.
 * Requirements sit in leaf groups only, in the same order as the groups, so each group's
 * requirements are contiguous. A flat framework has no groups, and no requirement names one.
 */
export function validateGroups(
  file: FrameworkFile,
  add: (rule: GroupRule, message: string) => void,
): void {
  const version = file.version.key;
  if (!file.groups) {
    for (const r of file.requirements) {
      if (r.group !== undefined)
        add(
          "unexpected-requirement-group",
          `${version} has no groups, but requirement ${r.ref} names group ${r.group}`,
        );
    }
    return;
  }

  const parentOf = new Map<string, string | undefined>();
  const childrenOf = new Map<string, string[]>();
  const hasChildren = new Set(
    file.groups.flatMap((g) => (g.parent === undefined ? [] : [g.parent])),
  );
  for (const g of file.groups) {
    if (parentOf.has(g.key)) {
      add("duplicate-group-key", `${version} lists group ${g.key} twice`);
      continue;
    }
    parentOf.set(g.key, g.parent);
    if (g.parent === undefined) {
      childrenOf.set(g.key, []);
    } else if (!parentOf.has(g.parent)) {
      add(
        "invalid-group-parent",
        `${version} group ${g.key} names parent ${g.parent}, which is not an earlier group`,
      );
    } else if (parentOf.get(g.parent) !== undefined) {
      add(
        "group-too-deep",
        `${version} group ${g.key} would be a third level: its parent ${g.parent} has a parent`,
      );
    } else {
      childrenOf.get(g.parent)?.push(g.key);
    }
  }

  // Leaf groups in display order: each top-level group, or else its children in turn.
  const leaves = [...childrenOf].flatMap(([top, children]) =>
    children.length > 0 ? children : [top],
  );
  const leafIndex = new Map(leaves.map((key, i) => [key, i]));
  const used = new Set<string>();
  let last = -1;
  for (const r of file.requirements) {
    const where = `${version} requirement ${r.ref}`;
    if (r.group === undefined) {
      add("missing-requirement-group", `${where} names no group`);
    } else if (!parentOf.has(r.group)) {
      add("unknown-requirement-group", `${where} names unknown group ${r.group}`);
    } else if (hasChildren.has(r.group)) {
      add("requirement-group-not-leaf", `${where} names group ${r.group}, which has subgroups`);
    } else {
      const index = leafIndex.get(r.group);
      if (index === undefined) continue; // An invalid group, reported above.
      used.add(r.group);
      if (index < last)
        add(
          "requirement-group-out-of-order",
          `${where} in group ${r.group} is out of order: list each group's requirements together, in the order of the groups`,
        );
      else last = index;
    }
  }
  for (const key of leaves) {
    if (!used.has(key)) add("empty-group", `${version} group ${key} has no requirements`);
  }
}
