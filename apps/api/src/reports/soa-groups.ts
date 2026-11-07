import type { SoaGroupDto, SoaRowDto } from "@isms/contracts";

/** The key of the synthetic group for requirements without one. */
export const OTHER_GROUP_KEY = "_other";

/**
 * Sync never deletes, so a grouped framework can keep a requirement the content no longer lists,
 * with no group. So that it still shows on screen and in files, such rows go under a trailing
 * "Other requirements" group with its own counts. Flat or fully grouped statements are unchanged.
 */
export function withOtherGroup(
  rows: SoaRowDto[],
  groups: SoaGroupDto[],
): { rows: SoaRowDto[]; groups: SoaGroupDto[] } {
  const loose = rows.filter((r) => r.groupKey === null);
  if (groups.length === 0 || loose.length === 0) return { rows, groups };
  const other: SoaGroupDto = {
    key: OTHER_GROUP_KEY,
    title: "Other requirements",
    parentKey: null,
    decided: loose.filter((r) => r.decision !== null).length,
    total: loose.length,
  };
  return {
    rows: rows.map((r) => (r.groupKey === null ? { ...r, groupKey: OTHER_GROUP_KEY } : r)),
    groups: [...groups, other],
  };
}

type GroupRef = { key: string; title: string; sortOrder: number };

/** A requirement's leaf group (with its parent, if any) and whether it has a decision. */
export type GroupedRow = {
  group: (GroupRef & { parent: GroupRef | null }) | null;
  decided: boolean;
};

type Tally = GroupRef & { parentKey: string | null; decided: number; total: number };

/**
 * The SoA's group headings (#19), with decided-of-total counts over every requirement in the
 * group and its subgroups. Display order: each top-level group by sortOrder, then its subgroups
 * by sortOrder. Groups without requirements are left out; a flat framework has none.
 */
export function soaGroups(rows: GroupedRow[]): SoaGroupDto[] {
  const tallies = new Map<string, Tally>();
  const count = (g: GroupRef, parentKey: string | null, decided: boolean) => {
    const t = tallies.get(g.key) ?? { ...g, parentKey, decided: 0, total: 0 };
    t.total += 1;
    if (decided) t.decided += 1;
    tallies.set(g.key, t);
  };
  for (const { group, decided } of rows) {
    if (group === null) continue;
    count(group, group.parent?.key ?? null, decided);
    if (group.parent !== null) count(group.parent, null, decided);
  }
  const bySort = (a: Tally, b: Tally) => a.sortOrder - b.sortOrder;
  const all = [...tallies.values()];
  return all
    .filter((t) => t.parentKey === null)
    .sort(bySort)
    .flatMap((top) => [top, ...all.filter((t) => t.parentKey === top.key).sort(bySort)])
    .map(({ key, title, parentKey, decided, total }) => ({
      key,
      title,
      parentKey,
      decided,
      total,
    }));
}
