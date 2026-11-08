import type {
  BoardTileDto,
  RegisterResponse,
  ReportScopeDto,
  SoaResponse,
  SoaRowDto,
} from "@isms/contracts";
import { OTHER_GROUP_KEY } from "../soa-groups.js";

/** What every file carries on its cover (global constraints "Files"). */
export type FileHeader = {
  generatedAt: string;
  generatedBy: string;
  organisation: string;
  scope: ReportScopeDto;
};

export const BRAND = "ComplAIent ISMS";
export const CONFIDENTIAL = "Confidential: internal use";

/** "2026-11-06 14:03 UTC" from an ISO date-time. */
export const utcDateTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * The cover's scope line. A scoped reader also sees the risks they reported or own outside
 * their units (risk visibility), so the line says so.
 */
export function scopeLine(scope: ReportScopeDto): string {
  if (scope.kind === "organisation") return "Scope: whole organisation";
  return scope.names.length === 0
    ? "Scope: risks you reported or own"
    : `Scope: ${scope.names.join(", ")}, plus risks you reported or own`;
}

/** Brand, organisation, generation, scope and the confidential marking, in that order. */
export function coverLines(h: FileHeader): string[] {
  return [
    BRAND,
    h.organisation,
    `Generated ${utcDateTime(h.generatedAt)} by ${h.generatedBy}`,
    scopeLine(h.scope),
    CONFIDENTIAL,
  ];
}

export type ReportFileKind = "risk-register" | "soa" | "board";

/**
 * `complaient-<report>[-<qualifier>]-<YYYY-MM-DD>.<ext>`, dated by the generation day (UTC).
 * The qualifier (for example a framework version key) is cut down to `[a-z0-9.-]`, so it can
 * never break out of the Content-Disposition filename.
 */
export const reportFileName = (
  report: ReportFileKind,
  ext: "xlsx" | "pdf",
  generatedAt: string,
  qualifier?: string | null,
): string => {
  const safe = (qualifier ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return `complaient-${report}${safe === "" ? "" : `-${safe}`}-${generatedAt.slice(0, 10)}.${ext}`;
};

/**
 * P7-R4: text that a spreadsheet could read as a formula (leading `= + - @`, tab or carriage
 * return) gets a leading apostrophe, so it is always shown as written.
 */
export const cellText = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export const STATE_LABEL: Record<RegisterResponse["rows"][number]["state"], string> = {
  proposed: "Proposed",
  in_review: "In review",
  approved: "Approved",
  returned: "Returned",
  closed: "Treated",
};

export const TREATMENT_LABEL: Record<
  NonNullable<RegisterResponse["rows"][number]["treatment"]>,
  string
> = {
  avoid: "Avoid",
  mitigate: "Mitigate",
  transfer: "Transfer",
  accept: "Accept",
};

export const FILTER_LABEL: Record<RegisterResponse["filter"], string> = {
  all: "All",
  toReview: "To review",
  awaitingMyApproval: "Awaiting my approval",
  aboveAppetite: "Above appetite",
  evidenceMissing: "Evidence missing",
  reviewDue: "Due for review",
  reportedByMe: "Reported by me",
  ownedByMe: "Owned by me",
  noExpectedScore: "No expected score",
};

export const STATUS_LABEL: Record<SoaRowDto["controls"][number]["status"], string> = {
  implementedTested: "Implemented and tested",
  implementedNotTested: "Implemented, not tested",
  implementedIneffective: "Implemented, not effective",
  notImplemented: "Not implemented",
};

export const includeClosedLine = (includeClosed: boolean): string =>
  includeClosed ? "Treated risks included" : "Treated risks left out";

export const yesNo = (value: boolean | null): string =>
  value === null ? "" : value ? "Yes" : "No";

export const NOT_DECIDED = "Not decided yet";

export const applicability = (row: SoaRowDto): string =>
  row.decision === null ? NOT_DECIDED : row.decision.applicable ? "Applicable" : "Not applicable";

const risks = (n: number) => `${String(n)} ${n === 1 ? "risk" : "risks"}`;

/** The suggestion for an undecided requirement; decided requirements show none. */
export function hintText(row: SoaRowDto): string {
  if (row.decision !== null) return "";
  if (row.hint.kind === "unused") return "No risk uses its controls yet";
  const { refs, hiddenCount } = row.hint;
  if (refs.length === 0) return `Used by ${risks(hiddenCount)} outside your scope`;
  const hidden = hiddenCount > 0 ? `, and ${risks(hiddenCount)} outside your scope` : "";
  return `Used by ${refs.join(", ")}${hidden}`;
}

export const controlLine = (c: SoaRowDto["controls"][number]): string =>
  `${c.code} ${c.title}: ${STATUS_LABEL[c.status]}`;

export const frameworkLabel = (f: { name: string; versionLabel: string } | null): string =>
  f === null ? "No framework confirmed" : `${f.name} ${f.versionLabel}`;

type SoaGroup = SoaResponse["groups"][number];

/** What a framework calls its group levels (#19); others are "Group" and "Subgroup". */
const GROUP_LEVEL_NAMES: Record<string, string[]> = {
  "nist-csf-2.0": ["Function", "Category"],
  "iso27001-2022": ["Theme"],
  "nist-sp800-53-r5": ["Family"],
  "eu-ai-act-2024-1689": ["Chapter"],
};

/** The names of the SoA's group levels, top first: none for a flat framework. */
export function groupLevels(s: Pick<SoaResponse, "framework" | "groups">): string[] {
  if (s.groups.length === 0) return [];
  const depth = s.groups.some((g) => g.parentKey !== null) ? 2 : 1;
  const known = s.framework === null ? undefined : GROUP_LEVEL_NAMES[s.framework.key];
  return known?.length === depth ? known : ["Group", "Subgroup"].slice(0, depth);
}

/** "GV.OC Organisational context"; the synthetic Other requirements group by its title alone. */
export const groupLabel = (g: SoaGroup): string =>
  g.key === OTHER_GROUP_KEY ? g.title : `${g.key} ${g.title}`;

/** "GV Govern · 12 of 31 decided": a group heading, as on screen. */
export const groupHeading = (g: SoaGroup): string =>
  `${groupLabel(g)} · ${String(g.decided)} of ${String(g.total)} decided`;

/** A row's groups, top level first (one or two); none when flat or unknown. */
export function rowGroups(s: Pick<SoaResponse, "groups">, row: SoaRowDto): SoaGroup[] {
  const leaf = s.groups.find((g) => g.key === row.groupKey);
  if (leaf === undefined) return [];
  const parent = s.groups.find((g) => g.key === leaf.parentKey);
  return parent === undefined ? [leaf] : [parent, leaf];
}

/**
 * The SoA as a tree for headings: each top-level group with its rows (one level) or its
 * subgroups with theirs (two levels), in display order.
 */
export function groupTree(
  s: Pick<SoaResponse, "groups" | "rows">,
): { group: SoaGroup; rows: SoaRowDto[]; children: { group: SoaGroup; rows: SoaRowDto[] }[] }[] {
  const rowsOf = (key: string) => s.rows.filter((r) => r.groupKey === key);
  return s.groups
    .filter((g) => g.parentKey === null)
    .map((group) => ({
      group,
      rows: rowsOf(group.key),
      children: s.groups
        .filter((c) => c.parentKey === group.key)
        .map((c) => ({ group: c, rows: rowsOf(c.key) })),
    }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct" from "2026-10-01". */
export const dayMonth = (isoDate: string): string =>
  `${String(Number(isoDate.slice(8, 10)))} ${MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ""}`;

/** "Sep" from "2026-09" (the previous-period key of a month). */
export const shortMonth = (key: string): string => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

/**
 * A tile's change line, as on screen: "▲3 vs Sep", "▼2 vs previous 30 days", "No change vs Sep",
 * "▲2 since 1 Oct"; above appetite adds "more" or "fewer"; tiles without a change line say "now".
 */
export function changeText(tile: BoardTileDto, monthName: (key: string) => string): string {
  const c = tile.change;
  if (c === null) return "now";
  const when =
    c.basis.kind === "since"
      ? `since ${dayMonth(c.basis.date)}`
      : `vs ${c.basis.period.key === "prev-30-days" ? "previous 30 days" : monthName(c.basis.period.key)}`;
  if (c.direction === "same") return `No change ${when}`;
  const word = tile.key === "aboveAppetite" ? ` ${c.direction === "up" ? "more" : "fewer"}` : "";
  return `${c.direction === "up" ? "▲" : "▼"}${String(c.delta)}${word} ${when}`;
}
