import type { ErrorDetail } from "@isms/domain";

export type UnitDiff<S, I> = {
  /** Unknown or repeated ids, at `<field>.<i>.id`. Nothing may be written when non-empty. */
  invalid: ErrorDetail[];
  /** Entries without an id, in input order. */
  create: I[];
  /** Listed stored units whose values change (unchanged ones are left out). */
  update: { stored: S; input: I }[];
  /** Stored units the input no longer lists. */
  remove: S[];
};

/**
 * Compares a complete replacement list of units (sites or departments) with the stored ones
 * (PF21: one diff for both). An entry with a stored id keeps that unit, an entry without an
 * id adds one, and a stored unit that is not listed is removed.
 */
export function diffUnits<S extends { id: string }, I extends { id?: string | undefined }>(
  field: string,
  stored: readonly S[],
  input: readonly I[],
  same: (stored: S, input: I) => boolean,
): UnitDiff<S, I> {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const diff: UnitDiff<S, I> = { invalid: [], create: [], update: [], remove: [] };
  input.forEach((entry, i) => {
    if (entry.id === undefined) {
      diff.create.push(entry);
      return;
    }
    const match = byId.get(entry.id);
    if (!match || listed.has(entry.id)) {
      diff.invalid.push({
        path: `${field}.${String(i)}.id`,
        message: match ? "Listed more than once" : "No such unit",
      });
      return;
    }
    listed.add(entry.id);
    if (!same(match, entry)) diff.update.push({ stored: match, input: entry });
  });
  diff.remove = stored.filter((s) => !listed.has(s.id));
  return diff;
}
