import type { BoardOwnerRowDto, BoardPackResponse, BoardTileDto } from "@isms/contracts";
import { BOARD_TILES } from "@isms/domain";
import { tokens } from "@isms/ui/tokens";
import { changeText, dayMonth, shortMonth } from "./common.js";
import { TILE_ICON_SVG } from "./icons.js";
import { type Content, MUTED, RULE, table } from "./pdf-frame.js";
import { type TileColours, movementSvg, ownerBarSvg } from "./svg.js";

const COLOURS: TileColours = {
  accent: tokens.light.accent,
  critical: tokens.light.critical,
  chartBlue: tokens.light.chartBlue,
  chartTeal: tokens.light.chartTeal,
  ok: tokens.light.ok,
  attention: tokens.light.attention,
  textMuted: tokens.light.textMuted,
};

const TILE_LABEL: Record<BoardTileDto["key"], string> = {
  openRisks: "Open risks now",
  aboveAppetite: "Above appetite now",
  reported: "Reported in period",
  approved: "Approval decisions in period",
  closed: "Treated in period",
  overdueActions: "Overdue actions now",
  reviewsDue: "Reviews due now",
};

const TONE_COLOUR = {
  neutral: COLOURS.textMuted,
  worse: COLOURS.critical,
  better: COLOURS.ok,
};

/**
 * The change line. Roboto has no triangle glyphs, so the arrow is drawn as a small SVG
 * triangle; the words follow it and carry the meaning (colour never does alone).
 */
function changeLine(tile: BoardTileDto): Content {
  const full = changeText(tile, shortMonth);
  const colour = TONE_COLOUR[tile.change?.tone ?? "neutral"];
  const bold = tile.change !== null && tile.change.tone !== "neutral";
  const arrow = full.startsWith("▲") ? "up" : full.startsWith("▼") ? "down" : null;
  if (arrow === null) return { text: full, fontSize: 7.5, bold, color: colour };
  const points = arrow === "up" ? "0,7 3.5,0 7,7" : "0,0 7,0 3.5,7";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 7 7"><polygon points="${points}" fill="${colour}"/></svg>`;
  return {
    columns: [
      { svg, width: 7, height: 7, margin: [0, 1.5, 0, 0] },
      { text: full.slice(1), fontSize: 7.5, bold, color: colour, margin: [3, 0, 0, 0] },
    ],
  };
}

function tileCell(tile: BoardTileDto, token: keyof TileColours, icon: BoardTileKeyIcon): Content {
  const colour = COLOURS[token];
  return {
    stack: [
      {
        columns: [
          { svg: icon(colour), width: 14, height: 14 },
          { text: TILE_LABEL[tile.key], color: MUTED, margin: [4, 2, 0, 0] },
        ],
      },
      {
        text: String(tile.value),
        fontSize: 20,
        bold: true,
        margin: [0, 2, 0, 0],
      },
      changeLine(tile),
    ],
    margin: [2, 3, 2, 3],
  };
}
type BoardTileKeyIcon = (colour: string) => string;

/** Seven status tiles as a 4 + 3 grid, in the display order of BOARD_TILES. */
export function tilesBlock(b: BoardPackResponse): Content[] {
  const cells = BOARD_TILES.flatMap((def): Content[] => {
    const tile = b.tiles.find((t) => t.key === def.key);
    return tile ? [tileCell(tile, def.token, TILE_ICON_SVG[def.key])] : [];
  });
  const padded: Content[] = [...cells];
  while (padded.length % 4 !== 0) padded.push({ text: "" });
  const rows: Content[][] = [];
  for (let i = 0; i < padded.length; i += 4) rows.push(padded.slice(i, i + 4));
  return [
    {
      table: { widths: ["*", "*", "*", "*"], body: rows },
      layout: {
        hLineColor: () => RULE,
        vLineColor: () => RULE,
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
      },
    },
    { text: "Above appetite uses today's appetite.", style: "note" },
  ];
}

/** The numbers behind the chart, in small print. */
function movementTable(b: BoardPackResponse): Content {
  const row = (label: string, key: "reported" | "approved" | "closed" | "openAtEnd"): Content[] => [
    { text: label, bold: true },
    ...b.movement.map((w) => ({ text: String(w[key]), alignment: "center" })),
  ];
  return {
    fontSize: 6.5,
    margin: [0, 4, 0, 0],
    table: {
      widths: [52, ...b.movement.map(() => "*")],
      body: [
        [
          { text: "Week of", color: MUTED },
          ...b.movement.map((w) => ({
            text: dayMonth(w.weekStart),
            color: MUTED,
            alignment: "center",
          })),
        ],
        row("Reported", "reported"),
        row("Approved", "approved"),
        row("Treated", "closed"),
        row("Open at week end", "openAtEnd"),
      ],
    },
    layout: {
      hLineColor: () => RULE,
      vLineWidth: () => 0,
      hLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
    },
  };
}

export function movementBlock(b: BoardPackResponse): Content[] {
  return [
    {
      svg: movementSvg(b.movement, COLOURS, 523, 140),
      width: 523,
      height: 140,
    },
    movementTable(b),
  ];
}

const MAX_OWNERS = 15;
const NAME_MAX = 40;
const BAR_WIDTH = 110;

export const truncate = (s: string, max = NAME_MAX): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

function sum(rows: BoardOwnerRowDto[]): BoardOwnerRowDto {
  const add = (f: (r: BoardOwnerRowDto) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    ownerId: null,
    owner: null,
    owned: add((r) => r.owned),
    open: add((r) => r.open),
    closedNow: add((r) => r.closedNow),
    treatedInPeriod: add((r) => r.treatedInPeriod),
    overdueActions: add((r) => r.overdueActions),
  };
}

/** "By risk owner": the top 15 owners by open risks, then the rest summed. */
export function ownersBlock(b: BoardPackResponse): Content[] {
  if (b.owners.length === 0) return [{ text: "No owned risks in scope.", style: "note" }];
  const shown = b.owners.slice(0, MAX_OWNERS);
  const rest = b.owners.slice(MAX_OWNERS);
  const maxOwned = Math.max(0, ...b.owners.map((r) => r.owned));
  const line = (name: string, r: BoardOwnerRowDto, bar = true): Content[] => [
    name,
    { text: String(r.owned), alignment: "center" },
    { text: String(r.open), alignment: "center" },
    { text: String(r.treatedInPeriod), alignment: "center" },
    {
      text: String(r.overdueActions),
      alignment: "center",
      ...(r.overdueActions > 0 ? { color: COLOURS.critical, bold: true } : {}),
    },
    bar
      ? { svg: ownerBarSvg(r, maxOwned, COLOURS, BAR_WIDTH), width: BAR_WIDTH, height: 12 }
      : { text: `${String(r.open)} + ${String(r.closedNow)}`, color: MUTED },
  ];
  const rows = shown.map((r) => line(truncate(r.owner ?? "Unassigned"), r));
  if (rest.length > 0)
    rows.push(line(`All other owners (${String(rest.length)})`, sum(rest), false));
  return [
    table(
      ["*", 36, 36, 62, 62, BAR_WIDTH + 6],
      [
        "Owner",
        "Owned",
        "Open",
        "Treated (in the period)",
        "Overdue actions",
        "Open + treated now",
      ],
      rows,
    ),
    {
      text: "Bar: where owned risks stand now (open and treated). Treated column: in the selected period.",
      style: "note",
    },
  ];
}
