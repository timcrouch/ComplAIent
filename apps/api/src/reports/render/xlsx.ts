import type { Blob } from "node:buffer";
import type { Stream } from "node:stream";
import type { RegisterResponse, RegisterRowDto, SoaResponse, SoaRowDto } from "@isms/contracts";
import { tokens } from "@isms/ui/tokens";
import writeXlsxFile, {
  type Cell,
  type Feature,
  type Row,
  type Sheet,
} from "write-excel-file/node";
import {
  FILTER_LABEL,
  type FileHeader,
  STATE_LABEL,
  TREATMENT_LABEL,
  applicability,
  cellText,
  controlLine,
  coverLines,
  frameworkLabel,
  groupLabel,
  groupLevels,
  hintText,
  includeClosedLine,
  rowGroups,
  yesNo,
} from "./common.js";

/** What write-excel-file's Node build accepts as file content (its `FileContent`). */
type FileContent = Stream | Buffer | Blob;

const DATE_FORMAT = "yyyy-mm-dd";

/** Always an explicit string cell, quoted when it could read as a formula (P7-R4). */
const text = (value: string | null): Cell =>
  value === null || value === "" ? null : { type: String, value: cellText(value) };
const num = (value: number | null): Cell => (value === null ? null : { type: Number, value });
/** A real date (an ISO day at midnight UTC), shown as yyyy-mm-dd. */
const day = (iso: string | null): Cell =>
  iso === null
    ? null
    : { type: Date, value: new Date(`${iso.slice(0, 10)}T00:00:00Z`), format: DATE_FORMAT };
/** "Yes" for a risk above appetite: still the word, now bold and red. */
const aboveYes: Cell = {
  type: String,
  value: yesNo(true),
  fontWeight: "bold",
  textColor: tokens.light.critical,
};
const heading = (value: string): Cell => ({ type: String, value, fontWeight: "bold" });

/** Column letter of a 1-based index (A..Z is enough for these reports). */
const column = (n: number) => String.fromCharCode(64 + n);

/**
 * Turns on Excel's filter buttons over the first sheet's header and data rows. The element
 * must follow `sheetData` (the order the schema requires).
 */
function autoFilter(columns: number, rows: number): Feature<FileContent> {
  return {
    files: {
      transform: {
        "xl/worksheets/sheet{id}.xml": {
          transform: (content, _options, { sheetIndex }) =>
            sheetIndex === 0
              ? content.replace(
                  "</sheetData>",
                  `</sheetData><autoFilter ref="A1:${column(columns)}${String(rows)}"/>`,
                )
              : content,
        },
      },
    },
  };
}

/** The "About" sheet: the cover lines, then labelled details. */
function aboutSheet(h: FileHeader, details: [string, Cell][]): Sheet<FileContent> {
  const [brand, ...rest] = coverLines(h);
  return {
    sheet: "About",
    columns: [{ width: 28 }, { width: 60 }],
    data: [
      [heading(brand ?? "")],
      ...rest.map((line): Row => [text(line)]),
      [],
      ...details.map(([label, value]): Row => [heading(label), value]),
    ],
  };
}

async function workbook(
  data: Sheet<FileContent>,
  about: Sheet<FileContent>,
  columns: number,
): Promise<Buffer> {
  return writeXlsxFile([data, about], {
    features: [autoFilter(columns, data.data.length)],
  }).toBuffer();
}

const REGISTER_COLUMNS: [string, number][] = [
  ["Reference", 11],
  ["Title", 40],
  ["Owner", 20],
  ["Site", 16],
  ["Department", 16],
  ["State", 12],
  ["Likelihood", 10],
  ["Impact", 10],
  ["Score", 8],
  ["Above appetite", 14],
  ["Treatment", 12],
  ["Expected likelihood", 10],
  ["Expected impact", 10],
  ["Expected score", 10],
  ["Accepted controls", 24],
  ["Open actions", 10],
  ["Overdue actions", 10],
  ["Next review due", 14],
  ["Approved by", 20],
  ["Approved on", 14],
  ["Treated on", 14],
];

const registerRow = (r: RegisterRowDto): Row => [
  text(r.reference),
  text(r.title),
  text(r.owner),
  text(r.site),
  text(r.department),
  text(STATE_LABEL[r.state]),
  num(r.likelihood),
  num(r.impact),
  num(r.score),
  r.aboveAppetite === true ? aboveYes : text(yesNo(r.aboveAppetite)),
  text(r.treatment === null ? null : TREATMENT_LABEL[r.treatment]),
  num(r.residualLikelihood),
  num(r.residualImpact),
  num(r.residualScore),
  text(r.controls.join(", ")),
  num(r.openActions),
  num(r.overdueActions),
  day(r.nextReviewDue),
  text(r.approvedBy),
  day(r.approvedOn),
  day(r.closedOn),
];

/** The risk register (§5.2): one row per risk, a frozen and filtered header, an About sheet. */
export async function registerXlsx(r: RegisterResponse): Promise<Buffer> {
  const data: Sheet<FileContent> = {
    sheet: "Risk register",
    stickyRowsCount: 1,
    columns: REGISTER_COLUMNS.map(([, width]) => ({ width })),
    data: [REGISTER_COLUMNS.map(([name]) => heading(name)), ...r.rows.map(registerRow)],
  };
  const about = aboutSheet(r, [
    ["Report", text("Risk register")],
    ["Filter", text(FILTER_LABEL[r.filter])],
    ["Treated risks", text(includeClosedLine(r.includeClosed))],
    ["Appetite threshold (score above it)", num(r.appetiteThreshold)],
    ["Risks", num(r.rows.length)],
  ]);
  return workbook(data, about, REGISTER_COLUMNS.length);
}

const SOA_COLUMNS: [string, number][] = [
  ["Reference", 12],
  ["Title", 44],
  ["Applicability", 16],
  ["Justification", 50],
  ["Decided by", 20],
  ["Decided on", 14],
  ["Suggestion", 36],
  ["Controls and implementation", 50],
  ["Risks", 24],
];

const soaRow = (s: SoaRowDto): Row => [
  text(s.ref),
  text(s.title),
  text(applicability(s)),
  text(s.decision?.justification ?? null),
  text(s.decision?.decidedBy ?? null),
  day(s.decision?.decidedAt ?? null),
  text(hintText(s)),
  s.controls.length === 0
    ? null
    : { type: String, value: cellText(s.controls.map(controlLine).join("\n")), wrap: true },
  text(s.riskRefs.join(", ")),
];

/**
 * The Statement of Applicability (§5.3): references and paraphrased titles only, never the
 * requirement's full text (P7-R2: files stay safe to share).
 */
export async function soaXlsx(s: SoaResponse): Promise<Buffer> {
  // Grouped frameworks lead with a column per group level, e.g. Function and Category (#19).
  const levels = groupLevels(s);
  const columns: [string, number][] = [
    ...levels.map((l): [string, number] => [l, 28]),
    ...SOA_COLUMNS,
  ];
  const groupCells = (row: SoaRowDto): Cell[] => {
    const groups = rowGroups(s, row);
    return levels.map((_, i) => {
      const g = groups[i];
      return g === undefined ? null : text(groupLabel(g));
    });
  };
  const data: Sheet<FileContent> = {
    sheet: "Statement of Applicability",
    stickyRowsCount: 1,
    columns: columns.map(([, width]) => ({ width })),
    data: [
      columns.map(([name]) => heading(name)),
      ...s.rows.map((row): Row => [...groupCells(row), ...soaRow(row)]),
    ],
  };
  const about = aboutSheet(s, [
    ["Report", text("Statement of Applicability")],
    ["Framework", text(frameworkLabel(s.framework))],
    ["Requirements", num(s.rows.length)],
  ]);
  return workbook(data, about, columns.length);
}
