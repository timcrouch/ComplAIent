import type { BoardPackResponse, RiskMapResponse } from "@isms/contracts";
import { isAboveAppetite, riskScore } from "@isms/domain";
import { tokens } from "@isms/ui/tokens";
import { movementBlock, ownersBlock, tilesBlock } from "./board-sections.js";
import { TREATMENT_LABEL } from "./common.js";
import { type Content, MUTED, type PdfDoc, framedDoc, opt, renderPdf, table } from "./pdf-frame.js";

/** Map shading (P5-R3): cells whose score is above the appetite threshold stand out. */
const ABOVE = tokens.light.criticalSoft;
const ABOVE_TEXT = tokens.light.critical;
const WITHIN = "#E3EFE3";
const LEVELS = [1, 2, 3, 4, 5] as const;

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * A risk map as a 5×5 table (not an image): a header row of impacts 1–5, then one row per
 * likelihood from 5 down to 1, each cell holding its count and shaded by appetite.
 */
export function mapTable(map: RiskMapResponse): {
  table: { widths: number[]; body: Content[][] };
  layout: Record<string, unknown>;
} {
  const count = (likelihood: number, impact: number) =>
    map.cells.find((c) => c.likelihood === likelihood && c.impact === impact)?.count;
  const head: Content[] = [
    { text: "L \\ I", color: MUTED, fontSize: 6 },
    ...LEVELS.map((i) => ({
      text: String(i),
      bold: true,
      alignment: "center",
    })),
  ];
  const rows = [...LEVELS].reverse().map((likelihood): Content[] => [
    { text: String(likelihood), bold: true, alignment: "center" },
    ...LEVELS.map((impact) => {
      const n = count(likelihood, impact);
      return {
        text: n === undefined ? "" : String(n),
        alignment: "center",
        bold: n !== undefined,
        ...(isAboveAppetite(riskScore(likelihood, impact), map.appetiteThreshold)
          ? { fillColor: ABOVE, color: ABOVE_TEXT }
          : { fillColor: WITHIN }),
      };
    }),
  ]);
  return {
    table: { widths: [22, 30, 30, 30, 30, 30], body: [head, ...rows] },
    layout: {
      hLineColor: () => "#FFFFFF",
      vLineColor: () => "#FFFFFF",
      hLineWidth: () => 1.5,
      vLineWidth: () => 1.5,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  };
}

function mapBlock(title: string, map: RiskMapResponse): Content {
  const notes = [
    plural(map.total, "risk", "risks"),
    ...(map.unscored > 0 ? [`${String(map.unscored)} not yet scored`] : []),
    ...(map.unplaced > 0 ? [`${String(map.unplaced)} without an expected score`] : []),
  ];
  return {
    stack: [
      { text: title, bold: true, margin: [0, 0, 0, 4] },
      mapTable(map),
      { text: "Likelihood (rows) × impact (columns)", style: "note" },
      { text: notes.join(" · "), style: "note" },
    ],
  };
}

function topRisks(b: BoardPackResponse): Content {
  if (b.topRisks.length === 0) return "No open risk is above appetite.";
  return table(
    [38, "*", 70, 50, 30, 42, 52],
    ["Ref.", "Risk", "Owner", "Treatment", "Score", "Expected", "Actions"],
    b.topRisks.map((r): Content[] => [
      { text: r.reference, bold: true },
      r.title,
      opt(r.owner),
      r.treatment === null ? "" : TREATMENT_LABEL[r.treatment],
      String(r.score),
      opt(r.residualScore),
      `${String(r.actions.done)} of ${String(r.actions.total)} done`,
    ]),
  );
}

function narrative(b: BoardPackResponse): Content[] {
  if (b.narrative === null) return [];
  const { text, approvedBy, approvedAt, aiAssisted } = b.narrative;
  const on = approvedAt.slice(0, 10);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p): Content => ({ text: p, margin: [0, 0, 0, 4], fontSize: 9 }));
  return [
    { text: "Summary", style: "section" },
    ...paragraphs,
    {
      text: aiAssisted
        ? `Summary drafted with AI assistance and approved by ${approvedBy} on ${on}`
        : `Summary approved by ${approvedBy} on ${on}`,
      style: "note",
    },
  ];
}

/** The board pack's document (A4 portrait, up to three pages), all from the pack's records. */
export function boardPdfDoc(b: BoardPackResponse): PdfDoc {
  return framedDoc(b, "Board pack", "portrait", [
    { text: `Period: ${b.period.start} to ${b.period.end}`, style: "subtitle" },
    ...tilesBlock(b),
    { text: "Risk map", style: "section" },
    {
      columns: [
        mapBlock("Now (inherent)", b.mapNow),
        mapBlock("Expected (after treatment)", b.mapExpected),
      ],
      columnGap: 24,
    },
    { text: "Movement over 12 weeks", style: "section" },
    ...movementBlock(b),
    { text: "By risk owner", style: "section" },
    ...ownersBlock(b),
    { text: "Top risks above appetite", style: "section" },
    topRisks(b),
    ...narrative(b),
  ]);
}

export function boardPdf(b: BoardPackResponse): Promise<Buffer> {
  return renderPdf(boardPdfDoc(b));
}
