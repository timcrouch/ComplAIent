import type { RegisterResponse, RegisterRowDto, SoaResponse, SoaRowDto } from "@isms/contracts";
import { tokens } from "@isms/ui/tokens";
import {
  FILTER_LABEL,
  STATE_LABEL,
  TREATMENT_LABEL,
  applicability,
  controlLine,
  frameworkLabel,
  groupHeading,
  groupTree,
  hintText,
  includeClosedLine,
  yesNo,
} from "./common.js";
import { type Content, MUTED, type PdfDoc, framedDoc, opt, renderPdf, table } from "./pdf-frame.js";

export { boardPdf, boardPdfDoc, mapTable } from "./board-pdf.js";

const expected = (r: RegisterRowDto): string =>
  r.residualScore === null
    ? ""
    : `${opt(r.residualLikelihood)} × ${opt(r.residualImpact)} = ${String(r.residualScore)}`;

const approved = (r: RegisterRowDto): Content =>
  r.approvedBy === null ? "" : { stack: [r.approvedBy, { text: opt(r.approvedOn), color: MUTED }] };

const registerRow = (r: RegisterRowDto): Content[] => [
  { text: r.reference, bold: true },
  r.title,
  opt(r.owner),
  { stack: [opt(r.site), { text: opt(r.department), color: MUTED }] },
  STATE_LABEL[r.state],
  opt(r.likelihood),
  opt(r.impact),
  opt(r.score),
  r.aboveAppetite === true
    ? { text: yesNo(true), bold: true, color: tokens.light.critical }
    : yesNo(r.aboveAppetite),
  r.treatment === null ? "" : TREATMENT_LABEL[r.treatment],
  expected(r),
  r.controls.join(", "),
  `${String(r.openActions)} / ${String(r.overdueActions)}`,
  opt(r.nextReviewDue),
  approved(r),
  opt(r.closedOn),
];

const REGISTER_HEAD = [
  "Ref.",
  "Title",
  "Owner",
  "Site / department",
  "State",
  "L",
  "I",
  "Score",
  "Above appetite",
  "Treatment",
  "Expected",
  "Accepted controls",
  "Actions open / overdue",
  "Next review",
  "Approved",
  "Treated on",
];
/** Fixed widths that leave the title about 115pt on A4 landscape (cell padding included). */
const REGISTER_WIDTHS = [30, "*", 48, 50, 34, 12, 12, 20, 26, 34, 38, 52, 30, 40, 50, 40];

/** The risk register's document (A4 landscape), one table row per risk. */
export function registerPdfDoc(r: RegisterResponse): PdfDoc {
  const subtitle = [
    `Filter: ${FILTER_LABEL[r.filter]}`,
    includeClosedLine(r.includeClosed),
    `Appetite: scores above ${String(r.appetiteThreshold)}`,
    `${String(r.rows.length)} ${r.rows.length === 1 ? "risk" : "risks"}`,
  ].join(" · ");
  const body: Content =
    r.rows.length === 0
      ? "No risks match this report."
      : table(REGISTER_WIDTHS, REGISTER_HEAD, r.rows.map(registerRow));
  return framedDoc(r, "Risk register", "landscape", [
    { text: subtitle, style: "subtitle" },
    { stack: [body], fontSize: 7 },
  ]);
}

export function registerPdf(r: RegisterResponse): Promise<Buffer> {
  return renderPdf(registerPdfDoc(r));
}

function decision(s: SoaRowDto): Content {
  const lines: Content[] = [{ text: applicability(s), bold: true }];
  if (s.decision !== null) {
    lines.push(s.decision.justification, {
      text: `Decided by ${s.decision.decidedBy} on ${s.decision.decidedAt.slice(0, 10)}`,
      color: MUTED,
    });
  } else {
    lines.push({ text: hintText(s), italics: true, color: MUTED });
  }
  return { stack: lines };
}

/** Reference and paraphrased title only: the full text never goes into a file (P7-R2). */
const soaRow = (s: SoaRowDto): Content[] => [
  { text: s.ref, bold: true },
  s.title,
  decision(s),
  s.controls.length === 0 ? "" : { stack: s.controls.map(controlLine) },
  s.riskRefs.join(", "),
];

const soaTable = (rows: SoaRowDto[]): Content =>
  table(
    [40, "*", 150, 130, 50],
    ["Ref.", "Requirement", "Applicability", "Controls and implementation", "Risks"],
    rows.map(soaRow),
  );

/** Grouped frameworks (#19): a heading per group with its counts, then its requirements. */
function groupedBody(s: SoaResponse): Content[] {
  return groupTree(s).flatMap(({ group, rows, children }) => [
    { text: groupHeading(group), bold: true, fontSize: 11, margin: [0, 12, 0, 4] },
    ...(children.length === 0
      ? [soaTable(rows)]
      : children.flatMap((c) => [
          { text: groupHeading(c.group), bold: true, fontSize: 9, margin: [0, 8, 0, 3] },
          soaTable(c.rows),
        ])),
  ]);
}

/** The Statement of Applicability's document (A4 portrait). */
export function soaPdfDoc(s: SoaResponse): PdfDoc {
  const body: Content =
    s.framework === null
      ? "No framework has been confirmed yet."
      : s.groups.length === 0
        ? soaTable(s.rows)
        : groupedBody(s);
  return framedDoc(s, "Statement of Applicability", "portrait", [
    {
      text: `${frameworkLabel(s.framework)} · ${String(s.rows.length)} requirements`,
      style: "subtitle",
    },
    { stack: [body], fontSize: 7 },
  ]);
}

export function soaPdf(s: SoaResponse): Promise<Buffer> {
  return renderPdf(soaPdfDoc(s));
}
