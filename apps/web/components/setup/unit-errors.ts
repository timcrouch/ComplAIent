import { conflictReasons } from "@isms/contracts";
import type { SetupErrorKey } from "./save-flow";

export type UnitList = "sites" | "departments";
export type RowError = { name?: SetupErrorKey; countryCode?: SetupErrorKey; row?: SetupErrorKey };
/** Errors by row key, plus a list-level error for "no sites". */
export type UnitErrors = { rows: Record<string, RowError>; sitesRequired: boolean };

type Issue = { path: readonly PropertyKey[]; code?: string };

const NAME_ERRORS = {
  sites: { invalid: "siteName", duplicate: "siteNameDuplicate" },
  departments: { invalid: "departmentName", duplicate: "departmentNameDuplicate" },
} as const satisfies Record<UnitList, Record<string, SetupErrorKey>>;

/**
 * Places contract problems on rows. `keys` are the row keys in the order they were sent, so
 * `sites.<i>` finds its row. Duplicate names are told apart by the Zod issue code (`custom`,
 * from the contract's uniqueNames); an unknown stored id (`<list>.<i>.id`) means the list
 * changed elsewhere since the page loaded. Returns whether anything was placed.
 */
export function placeIssues(
  issues: readonly Issue[],
  keys: Record<UnitList, readonly string[]>,
  errors: UnitErrors,
): boolean {
  let placed = false;
  for (const { path, code } of issues) {
    const [list, index, field] = path.map(String);
    if (list !== "sites" && list !== "departments") continue;
    if (index === undefined) {
      // too_small (or an API detail, which has no code) means the site list is empty.
      if (list === "sites" && (code === undefined || code === "too_small")) {
        errors.sitesRequired = placed = true;
      }
      continue;
    }
    const key = keys[list][Number(index)];
    if (key === undefined) continue;
    const row = (errors.rows[key] ??= {});
    if (field === "name") {
      row.name = code === "custom" ? NAME_ERRORS[list].duplicate : NAME_ERRORS[list].invalid;
    } else if (field === "countryCode") {
      row.countryCode = "country";
    } else if (field === "id") {
      row.row = "staleSite";
    } else continue;
    placed = true;
  }
  return placed;
}

/** `siteInUse.<id>` / `departmentInUse.<id>` conflicts, as the ids of the refused removals. */
export function unitsInUse(details: readonly { path: string; message: string }[]) {
  const inUse = { sites: [] as string[], departments: [] as string[] };
  for (const { reason, item } of conflictReasons(details)) {
    if (item === null) continue;
    if (reason === "siteInUse") inUse.sites.push(item);
    if (reason === "departmentInUse") inUse.departments.push(item);
  }
  return inUse;
}

/** API details carry a dotted path; turn them into issues (no code: never a duplicate). */
export const detailIssues = (details: readonly { path: string }[]): Issue[] =>
  details.map((d) => ({ path: d.path.split(".") }));
