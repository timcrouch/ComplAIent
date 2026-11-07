import { loadLibrary } from "@isms/control-library";
import type { LibraryIds, SampleRows } from "../src/index.js";

/**
 * Dates the plan must hold up at: a normal weekday, inside and just after the December
 * holiday, a mid-January date whose review window the holiday squeezes, and a night time.
 * (A 200-date sweep across 2026-2027 passed while tuning; these keep the edge cases.)
 */
export const NOWS = [
  "2026-11-06T10:15:00.000Z",
  "2026-12-24T12:00:00.000Z",
  "2027-01-04T08:00:00.000Z",
  "2026-01-19T12:18:00.000Z",
  "2027-07-29T17:00:00.000Z",
  "2026-12-31T00:01:00.000Z",
] as const;

/** Library ids for the shipped content, fake but stable (the real ones come from the database). */
export function fakeLibrary(): LibraryIds {
  const lib = loadLibrary();
  let n = 0;
  const id = () => {
    n += 1;
    return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  };
  return {
    frameworkVersions: Object.fromEntries(lib.frameworks.map((f) => [f.version.key, id()])),
    controls: Object.fromEntries(lib.controls.map((c) => [c.code, id()])),
    requirements: Object.fromEntries(
      lib.frameworks.flatMap((f) => f.requirements.map((r) => [`${f.version.key} ${r.ref}`, id()])),
    ),
  };
}

/**
 * The board pack's history rule (apps/api/src/reports/history.ts): the latest version of each
 * risk created before `at`; open = not closed; above = open and likelihood × impact > threshold.
 */
export function countsAt(
  rows: SampleRows,
  at: Date,
  threshold: number,
): { open: number; above: number } {
  const latest = new Map<string, { version: number; snapshot: Record<string, unknown> }>();
  for (const v of rows.riskVersions) {
    if (v.createdAt.getTime() >= at.getTime()) continue;
    const seen = latest.get(v.riskId);
    if (!seen || seen.version < v.version)
      latest.set(v.riskId, { version: v.version, snapshot: v.snapshot });
  }
  let open = 0;
  let above = 0;
  for (const { snapshot } of latest.values()) {
    if (snapshot["state"] === "closed") continue;
    open += 1;
    const l = snapshot["likelihood"];
    const i = snapshot["impact"];
    if (typeof l === "number" && typeof i === "number" && l * i > threshold) above += 1;
  }
  return { open, above };
}
