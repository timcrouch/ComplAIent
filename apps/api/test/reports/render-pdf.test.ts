import { describe, expect, it, vi } from "vitest";
import {
  boardPdf,
  boardPdfDoc,
  mapTable,
  registerPdf,
  registerPdfDoc,
  soaPdf,
  soaPdfDoc,
} from "../../src/reports/render/pdf.js";
import { tokens } from "@isms/ui/tokens";
import { changeText } from "../../src/reports/render/common.js";
import {
  boardFixture,
  registerFixture,
  registerRow,
  soaFixture,
  soaGroupedFixture,
  soaOtherFixture,
  soaThemedFixture,
} from "./fixtures.js";

const latin1 = (pdf: Buffer) => pdf.toString("latin1");
const pageCount = (pdf: Buffer) => latin1(pdf).match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
const A4_LANDSCAPE = "/MediaBox [0 0 841.89 595.28]";
const A4_PORTRAIT = "/MediaBox [0 0 595.28 841.89]";

/** Every string in a pdfmake content tree. */
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") return Object.values(node).flatMap(texts);
  return [];
}

type Frame = {
  header: (page: number, pages: number) => unknown;
  footer: (page: number, pages: number) => unknown;
};
const frame = (doc: unknown) => doc as Frame;

function expectFrame(doc: unknown, scope: string) {
  const header = texts(frame(doc).header(2, 3)).join(" | ");
  for (const line of [
    "ComplAIent ISMS",
    "Acme Bank",
    "Generated 2026-11-06 14:03 UTC by Cora CISO",
    scope,
  ])
    expect(header).toContain(line);
  const footer = texts(frame(doc).footer(2, 3)).join(" | ");
  expect(footer).toContain("Page 2 of 3");
  expect(footer).toContain("Confidential: internal use");
}

describe("the page frame", () => {
  it("puts a long scope on its own full-width row and leaves room for it to wrap", async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Department number ${String(i + 1)}`);
    const fixture = {
      ...soaFixture(),
      scope: { kind: "units" as const, names },
    };
    const doc = soaPdfDoc(fixture);
    const header = frame(doc).header(1, 1) as { stack: unknown[] };
    const [top, scopeRow] = header.stack as [{ columns: unknown[] }, { text: string }];
    expect(texts(top)).not.toContain(scopeRow.text);
    expect(scopeRow).not.toHaveProperty("width");
    expect(scopeRow.text).toBe(`Scope: ${names.join(", ")}, plus risks you reported or own`);
    expect((doc as { pageMargins: number[] }).pageMargins[1]).toBeGreaterThanOrEqual(84);
    const pdf = await soaPdf(fixture);
    expect(latin1(pdf).startsWith("%PDF-")).toBe(true);
  });
});

describe("registerPdf", () => {
  it("renders an A4 landscape PDF with the header, footer and page numbers", async () => {
    const doc = registerPdfDoc(registerFixture());
    expectFrame(doc, "Scope: whole organisation");
    expect(texts(doc)).toEqual(expect.arrayContaining(["R-0001", "=SUM(A1)", "Treated"]));
    const pdf = await registerPdf(registerFixture());
    expect(latin1(pdf).startsWith("%PDF-")).toBe(true);
    expect(latin1(pdf)).toContain(A4_LANDSCAPE);
    expect(pageCount(pdf)).toBe(1);
  });

  it("runs over pages for a long register", async () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      registerRow({ reference: `R-${String(i + 1).padStart(4, "0")}` }),
    );
    const pdf = await registerPdf(registerFixture(rows));
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });

  it("says so when the register is empty", () => {
    expect(texts(registerPdfDoc(registerFixture([])))).toContain("No risks match this report.");
  });
});

describe("register above-appetite column", () => {
  it("prints Yes in the critical colour, bold, and leaves No plain", () => {
    const doc = registerPdfDoc(
      registerFixture([
        registerRow({ aboveAppetite: true }),
        registerRow({ aboveAppetite: false }),
      ]),
    );
    const cells: { text?: unknown; color?: string; bold?: boolean }[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        cells.push(n);
        Object.values(n).forEach(walk);
      }
    };
    walk(doc);
    const yes = cells.find((c) => c.text === "Yes");
    expect(yes).toMatchObject({ color: tokens.light.critical, bold: true });
    const no = cells.find((c) => c.text === "No");
    expect(no?.color).toBeUndefined();
  });

  it("shades the board map's above-appetite cells with the critical-soft token", () => {
    const table = mapTable(boardFixture().mapNow);
    const above = table.table.body[1]?.[5] as {
      fillColor: string;
      color: string;
    };
    expect(above.fillColor).toBe(tokens.light.criticalSoft);
    expect(above.color).toBe(tokens.light.critical);
  });
});

describe("soaPdf", () => {
  it("renders an A4 portrait PDF without licensed text", async () => {
    const doc = soaPdfDoc(soaFixture());
    expectFrame(doc, "Scope: Riga, plus risks you reported or own");
    const all = texts(doc);
    expect(all).toEqual(
      expect.arrayContaining(["A.5.1", "Not decided yet", "No risk uses its controls yet"]),
    );
    expect(all.join(" ")).not.toContain("LICENSED TEXT");
    const pdf = await soaPdf(soaFixture());
    expect(latin1(pdf).startsWith("%PDF-")).toBe(true);
    expect(latin1(pdf)).toContain(A4_PORTRAIT);
    expect(pageCount(pdf)).toBe(1);
  });

  it("puts each Function and Category under its own heading with its counts", async () => {
    const all = texts(soaPdfDoc(soaGroupedFixture()));
    expect(all).toEqual(
      expect.arrayContaining([
        "GV Govern · 1 of 3 decided",
        "GV.OC Organisational context · 1 of 2 decided",
        "GV.RM Risk management strategy · 0 of 1 decided",
        "ID Identify · 0 of 1 decided",
        "ID.AM Asset management · 0 of 1 decided",
      ]),
    );
    // Each heading comes before its requirements.
    expect(all.indexOf("GV.OC Organisational context · 1 of 2 decided")).toBeLessThan(
      all.indexOf("GV.OC-01"),
    );
    expect(all.indexOf("GV.OC-02")).toBeLessThan(
      all.indexOf("GV.RM Risk management strategy · 0 of 1 decided"),
    );
    expect(all.indexOf("ID.AM-01")).toBeGreaterThan(all.indexOf("ID Identify · 0 of 1 decided"));
    const pdf = await soaPdf(soaGroupedFixture());
    expect(latin1(pdf).startsWith("%PDF-")).toBe(true);
  });

  it("puts each ISO Annex A theme under its own heading", () => {
    const all = texts(soaPdfDoc(soaThemedFixture()));
    expect(all).toContain("A.5 Organisational controls · 1 of 1 decided");
    expect(all).toContain("A.8 Technological controls · 0 of 1 decided");
  });

  it("lists requirements without a group under Other requirements, last", () => {
    const all = texts(soaPdfDoc(soaOtherFixture()));
    expect(all).toContain("Other requirements · 0 of 1 decided");
    expect(all.indexOf("OLD-1")).toBeGreaterThan(
      all.indexOf("Other requirements · 0 of 1 decided"),
    );
  });

  it("has no group headings for a flat framework", () => {
    expect(texts(soaPdfDoc(soaFixture())).some((t) => / of \d+ decided$/.test(t))).toBe(false);
  });

  it("says when no framework is confirmed", () => {
    const doc = soaPdfDoc({
      ...soaFixture([]),
      framework: null,
      frameworks: [],
    });
    expect(texts(doc)).toContain("No framework has been confirmed yet.");
  });
});

describe("boardPdf", () => {
  it("renders one or two A4 portrait pages", async () => {
    const doc = boardPdfDoc(boardFixture());
    expectFrame(doc, "Scope: whole organisation");
    const all = texts(doc);
    expect(all).toEqual(
      expect.arrayContaining([
        "Open risks now",
        "Approval decisions in period",
        "Treated in period",
        "Reviews due now",
        "12",
        "R-0001",
        "Posture improved in October.",
        "Summary drafted with AI assistance and approved by April Approver on 2026-11-02",
      ]),
    );
    const pdf = await boardPdf(boardFixture());
    expect(latin1(pdf).startsWith("%PDF-")).toBe(true);
    expect(latin1(pdf)).toContain(A4_PORTRAIT);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    expect(pageCount(pdf)).toBeLessThanOrEqual(2);
  });

  it("renders chart text without any font warning (SVG fonts resolve on disk)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await boardPdf(boardFixture());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("prints a person-written narrative without the AI line, and none when absent", () => {
    const human = boardFixture({
      narrative: {
        text: "Written by hand.",
        approvedBy: "Cora CISO",
        approvedAt: "2026-11-02T10:00:00.000Z",
        aiAssisted: false,
      },
    });
    expect(texts(boardPdfDoc(human))).toContain("Summary approved by Cora CISO on 2026-11-02");
    expect(texts(boardPdfDoc(boardFixture({ narrative: null }))).join(" ")).not.toContain(
      "Summary",
    );
  });

  it("draws the map as a 5×5 table of counts, shaded above appetite", () => {
    const table = mapTable(boardFixture().mapNow);
    // Header row plus five likelihood rows (5 at the top), each a label plus five impacts.
    expect(table.table.body).toHaveLength(6);
    const cell = (likelihood: number, impact: number) =>
      table.table.body[6 - likelihood]?.[impact] as {
        text: string;
        fillColor: string;
      };
    expect(cell(5, 5).text).toBe("2");
    expect(cell(1, 2).text).toBe("7");
    expect(cell(3, 3).text).toBe("");
    expect(cell(5, 5).fillColor).not.toBe(cell(1, 2).fillColor);
    // Above appetite is strictly greater than the threshold (9).
    expect(cell(3, 3).fillColor).toBe(cell(1, 2).fillColor);
    expect(cell(2, 5).fillColor).toBe(cell(5, 5).fillColor);
  });

  it("orders tiles, maps, movement, owners, top risks and the summary", () => {
    const all = texts(boardPdfDoc(boardFixture()));
    const at = (t: string) => all.indexOf(t);
    expect(at("Open risks now")).toBeGreaterThan(-1);
    expect(at("Open risks now")).toBeLessThan(at("Risk map"));
    expect(at("Risk map")).toBeLessThan(at("Movement over 12 weeks"));
    expect(at("Movement over 12 weeks")).toBeLessThan(at("By risk owner"));
    expect(at("By risk owner")).toBeLessThan(at("Top risks above appetite"));
    expect(at("Top risks above appetite")).toBeLessThan(at("Summary"));
  });

  it("shows tile change copy, 'now' for point-in-time tiles, and the appetite note", () => {
    const all = texts(boardPdfDoc(boardFixture()));
    expect(all).toContain("2 since 1 Oct");
    expect(all).toContain("1 fewer since 1 Oct");
    expect(all).toContain("1 vs Sep");
    expect(all).toContain("No change vs Sep");
    expect(all).toContain("2 vs Sep");
    expect(all.filter((t) => t === "now")).toHaveLength(2);
    expect(all).toContain("Above appetite uses today's appetite.");
  });

  it("lists the top 15 owners then sums the rest", () => {
    const base = boardFixture().owners[0];
    if (!base) throw new Error("fixture");
    const owners = Array.from({ length: 20 }, (_, i) => ({
      ...base,
      ownerId: `id-${String(i)}`,
      owner: `Owner ${String(i).padStart(2, "0")}`,
      owned: 2,
      open: 1,
      closedNow: 1,
      treatedInPeriod: 1,
      overdueActions: 1,
    }));
    const all = texts(boardPdfDoc(boardFixture({ owners })));
    expect(all).toContain("Owner 14");
    expect(all).not.toContain("Owner 15");
    expect(all).toContain("All other owners (5)");
    expect(all).toContain(
      "Bar: where owned risks stand now (open and treated). Treated column: in the selected period.",
    );
  });

  it("labels a risk with no owner 'Unassigned'", () => {
    const base = boardFixture().owners[0];
    if (!base) throw new Error("fixture");
    const owners = [{ ...base, ownerId: null, owner: null }];
    const all = texts(boardPdfDoc(boardFixture({ owners })));
    expect(all).toContain("Unassigned");
    expect(all).not.toContain("No owner assigned");
  });

  it("truncates and escapes a long owner name in the bar-free table cell", () => {
    const base = boardFixture().owners[0];
    if (!base) throw new Error("fixture");
    const name = `<&>"${"x".repeat(80)}`;
    const doc = boardPdfDoc(boardFixture({ owners: [{ ...base, owner: name }] }));
    const all = texts(doc);
    const cell = all.find((t) => t.startsWith("<&>"));
    expect(cell).toBeDefined();
    expect(cell?.length).toBe(40);
    expect(cell?.endsWith("…")).toBe(true);
    const svgs = all.filter((t) => t.startsWith("<svg"));
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs.join("")).not.toContain("<&>");
  });

  it("renders the full pack within three pages", async () => {
    const pdf = await boardPdf(boardFixture());
    expect(latin1(pdf).startsWith("%PDF")).toBe(true);
    expect(pageCount(pdf)).toBeLessThanOrEqual(3);
  });
});

describe("changeText", () => {
  const month = (key: string) => ({ "2026-09": "Sep" })[key] ?? key;
  const basis = {
    kind: "previousPeriod",
    period: { key: "prev-30-days", start: "", end: "" },
  } as const;
  it("names the previous 30 days", () => {
    expect(
      changeText(
        {
          key: "reported",
          value: 1,
          change: { delta: 2, direction: "down", tone: "neutral", basis },
        },
        month,
      ),
    ).toBe("▼2 vs previous 30 days");
  });
  it("says now when there is no change line", () => {
    expect(changeText({ key: "reviewsDue", value: 1, change: null }, month)).toBe("now");
  });
});
