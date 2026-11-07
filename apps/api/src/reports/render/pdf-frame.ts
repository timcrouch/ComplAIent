import { createRequire } from "node:module";
import pdfmake from "pdfmake";
import { CONFIDENTIAL, type FileHeader, coverLines } from "./common.js";

/** A pdfmake content node: text, a list of nodes, or a node object (table, stack, columns…). */
export type Content = string | Content[] | { [key: string]: unknown };

/** The document definitions built here (a subset of pdfmake's). */
export type PdfDoc = {
  pageSize: "A4";
  pageOrientation: "portrait" | "landscape";
  pageMargins: [number, number, number, number];
  info: { title: string; author: string; creator: string };
  header: (page: number, pages: number) => Content;
  footer: (page: number, pages: number) => Content;
  content: Content[];
  styles: Record<string, Record<string, unknown>>;
  defaultStyle: Record<string, unknown>;
};

export const MUTED = "#555555";
export const RULE = "#BBBBBB";

/**
 * The top page margin: the header's 20pt offset, the brand and organisation lines, and room
 * for a scope line that wraps onto a second line (P7-R10).
 */
export const HEADER_HEIGHT = 84;

let ready = false;

const req = createRequire(import.meta.url);
const font = (file: string): string => req.resolve(`pdfmake/fonts/Roboto/${file}`);
/** Roboto by absolute path: svg-to-pdfkit (chart text) can only load fonts from disk. */
const FONT_FILES = {
  normal: font("Roboto-Regular.ttf"),
  bold: font("Roboto-Medium.ttf"),
  italics: font("Roboto-Italic.ttf"),
  bolditalics: font("Roboto-MediumItalic.ttf"),
};

/**
 * pdfmake with its bundled Roboto registered by on-disk path. Every URL is refused, and so is
 * every local file except those four font files: a report never fetches anything.
 */
function engine(): typeof pdfmake {
  if (!ready) {
    const allowed = new Set<string>(Object.values(FONT_FILES));
    pdfmake.setFonts({ Roboto: FONT_FILES });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path: string) => allowed.has(path));
    ready = true;
  }
  return pdfmake;
}

export function renderPdf(doc: PdfDoc): Promise<Buffer> {
  return engine().createPdf(doc).getBuffer();
}

/**
 * The page frame every report shares: on each page the brand, organisation and generation line
 * at the top with the scope on its own full-width row below, and the confidential marking with "Page N of M" at the bottom.
 */
export function framedDoc(
  h: FileHeader,
  title: string,
  orientation: PdfDoc["pageOrientation"],
  content: Content[],
): PdfDoc {
  const [brand = "", organisation = "", generated = "", scope = ""] = coverLines(h);
  return {
    pageSize: "A4",
    pageOrientation: orientation,
    pageMargins: [36, HEADER_HEIGHT, 36, 40],
    info: { title: `${title}, ${organisation}`, author: brand, creator: brand },
    header: () => ({
      margin: [36, 20, 36, 0],
      fontSize: 8,
      stack: [
        {
          columns: [
            { stack: [{ text: brand, bold: true }, { text: organisation }], width: "*" },
            { text: generated, width: "auto", alignment: "right", color: MUTED },
          ],
        },
        // P7-R10: the scope can name many units, so it has its own full-width row and wraps.
        { text: scope, color: MUTED, margin: [0, 2, 0, 0] },
      ],
    }),
    footer: (page, pages) => ({
      margin: [36, 12, 36, 0],
      columns: [
        { text: CONFIDENTIAL, bold: true, width: "*" },
        { text: `Page ${String(page)} of ${String(pages)}`, width: "auto", alignment: "right" },
      ],
      fontSize: 8,
    }),
    content: [{ text: title, style: "title" }, ...content],
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 9, color: MUTED, margin: [0, 0, 0, 10] },
      section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      th: { bold: true, fillColor: "#EEEEEE" },
      note: { fontSize: 7, color: MUTED, margin: [0, 2, 0, 0] },
    },
    defaultStyle: { font: "Roboto", fontSize: 8 },
  };
}

/** A table with a repeated, shaded header row and light rules. */
export function table(widths: (number | string)[], head: string[], rows: Content[][]): Content {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [head.map((text) => ({ text, style: "th" })), ...rows],
    },
    layout: {
      hLineColor: () => RULE,
      vLineColor: () => RULE,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
    },
  };
}

/** Text for an optional value: an empty cell when null. */
export const opt = (value: string | number | null): string => (value === null ? "" : String(value));
