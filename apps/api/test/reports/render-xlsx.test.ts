import { describe, expect, it } from "vitest";
import { cellText, coverLines, reportFileName } from "../../src/reports/render/common.js";
import { registerXlsx, soaXlsx } from "../../src/reports/render/xlsx.js";
import { tokens } from "@isms/ui/tokens";
import {
  registerFixture,
  registerRow,
  soaFixture,
  soaGroupedFixture,
  soaOtherFixture,
  soaRow,
  soaThemedFixture,
} from "./fixtures.js";
import { excelSerial, readXlsx } from "./xlsx-read.js";

describe("cellText (P7-R4 formula injection)", () => {
  it.each([
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+cmd", "'+cmd"],
    ["-1", "'-1"],
    ["@risk", "'@risk"],
    ["\tTab", "'\tTab"],
    ["\rCR", "'\rCR"],
    ["Plain", "Plain"],
    ["a=b", "a=b"],
    ["", ""],
  ])("writes %j as %j", (input, output) => {
    expect(cellText(input)).toBe(output);
  });
});

describe("cover and file names", () => {
  it("carries brand, organisation, generation, scope and marking", () => {
    expect(coverLines(registerFixture())).toEqual([
      "ComplAIent ISMS",
      "Acme Bank",
      "Generated 2026-11-06 14:03 UTC by Cora CISO",
      "Scope: whole organisation",
      "Confidential: internal use",
    ]);
    expect(coverLines(soaFixture())[3]).toBe("Scope: Riga, plus risks you reported or own");
  });

  it("names files complaient-<report>-<YYYY-MM-DD>.<ext> by the generation day (UTC)", () => {
    expect(reportFileName("risk-register", "xlsx", "2026-11-06T23:59:00.000Z")).toBe(
      "complaient-risk-register-2026-11-06.xlsx",
    );
    expect(reportFileName("board", "pdf", "2026-11-07T00:00:00.000Z")).toBe(
      "complaient-board-2026-11-07.pdf",
    );
  });

  it("adds a sanitised qualifier, such as a framework version key, after the report", () => {
    expect(reportFileName("soa", "pdf", "2026-11-07T00:00:00.000Z", "nist-csf-2.0")).toBe(
      "complaient-soa-nist-csf-2.0-2026-11-07.pdf",
    );
    expect(reportFileName("soa", "pdf", "2026-11-07T00:00:00.000Z", 'a/"b\r\n c')).toBe(
      "complaient-soa-a-b-c-2026-11-07.pdf",
    );
  });
});

describe("registerXlsx", () => {
  it("writes the register and an About sheet with a frozen, filtered header row", async () => {
    const book = readXlsx(await registerXlsx(registerFixture()));
    const workbook = book.xml("xl/workbook.xml");
    expect(workbook).toContain('name="Risk register"');
    expect(workbook).toContain('name="About"');
    const sheet = book.xml("xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<pane [^>]*ySplit="1"[^>]*state="frozen"/);
    expect(sheet).toContain('<autoFilter ref="A1:U4"/>');
    const strings = book.strings(1);
    expect(strings.slice(0, 3)).toEqual(["Reference", "Title", "Owner"]);
    expect(strings).toEqual(
      expect.arrayContaining([
        "R-0001",
        "Laptop left on the train",
        "Riga",
        "Approved",
        "Mitigate",
      ]),
    );
    expect(strings).toContain("GOV-01, SEC-02");
    expect(strings).toContain("Treated");
    expect(strings).toContain("Treated on");
    expect(strings).not.toContain("Closed on");
  });

  it("writes the above-appetite Yes in bold with the critical font colour", async () => {
    const book = readXlsx(
      await registerXlsx(registerFixture([registerRow({ aboveAppetite: true })])),
    );
    expect(book.strings(1)).toContain("Yes");
    const sheet = book.xml("xl/worksheets/sheet1.xml");
    // Shared-string index of "Yes" is its position among the sheet's string cells.
    const shared = [...book.xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)];
    const yesIndex = shared.findIndex((m) => />Yes</.test(m[1] ?? ""));
    expect(yesIndex).toBeGreaterThanOrEqual(0);
    const styles = book.xml("xl/styles.xml");
    const critical = tokens.light.critical.slice(1).toUpperCase();
    const fonts = [...styles.matchAll(/<font>([\s\S]*?)<\/font>/g)].map((m) => m[1] ?? "");
    const redBold = fonts.findIndex((f) => f.includes("<b/>") && f.includes(critical));
    expect(redBold).toBeGreaterThanOrEqual(0);
    const styled = new RegExp(`<c r="J2" s="\\d+" t="s"><v>${String(yesIndex)}</v>`);
    expect(sheet).toMatch(styled);
  });

  it("quotes formula-like text and writes no formulas", async () => {
    const book = readXlsx(await registerXlsx(registerFixture()));
    const strings = book.strings(1);
    expect(strings).toContain("'=SUM(A1)");
    expect(strings).toContain("'+cmd");
    expect(strings).toContain("'@risk\tname");
    expect(strings).not.toContain("=SUM(A1)");
    for (const sheet of [1, 2]) {
      expect(book.xml(`xl/worksheets/sheet${String(sheet)}.xml`)).not.toMatch(/<f[ >]/);
    }
  });

  it("writes dates as real dates and numbers as numbers", async () => {
    const sheet = readXlsx(await registerXlsx(registerFixture())).xml("xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(
      new RegExp(`<c r="R2" s="\\d+"><v>${String(excelSerial("2027-10-01"))}</v>`),
    );
    expect(sheet).toMatch(
      new RegExp(`<c r="T2" s="\\d+"><v>${String(excelSerial("2026-10-01"))}</v>`),
    );
    expect(sheet).toMatch(/<c r="I2"[^>]*><v>16<\/v>/);
  });

  it("puts the generation details, filters and appetite on the About sheet", async () => {
    const strings = readXlsx(await registerXlsx(registerFixture())).strings(2);
    expect(strings).toEqual(
      expect.arrayContaining([
        "ComplAIent ISMS",
        "Acme Bank",
        "Generated 2026-11-06 14:03 UTC by Cora CISO",
        "Scope: whole organisation",
        "Confidential: internal use",
        "Above appetite",
        "Treated risks",
        "Treated risks left out",
      ]),
    );
    const about = readXlsx(await registerXlsx(registerFixture())).xml("xl/worksheets/sheet2.xml");
    expect(about).toMatch(/<v>9<\/v>/);
  });

  it("writes an empty register as a header row only", async () => {
    const book = readXlsx(await registerXlsx(registerFixture([])));
    expect(book.xml("xl/worksheets/sheet1.xml")).toContain('<autoFilter ref="A1:U1"/>');
  });
});

describe("soaXlsx", () => {
  it("writes the SoA with decisions, statuses and hints, never licensed text", async () => {
    const book = readXlsx(await soaXlsx(soaFixture()));
    expect(book.xml("xl/workbook.xml")).toContain('name="Statement of Applicability"');
    const strings = book.strings(1);
    expect(strings).toEqual(
      expect.arrayContaining([
        "A.5.1",
        "Policies for information security",
        "Applicable",
        "We keep policies.",
        "Cora CISO",
        "GOV-01 Security policy: Implemented and tested",
        "R-0001",
        "'-Information security roles",
        "Not decided yet",
        "No risk uses its controls yet",
      ]),
    );
    const all = Object.values(book.files).map((f) => Buffer.from(f).toString("utf8"));
    expect(all.join("")).not.toContain("LICENSED TEXT");
    expect(book.xml("xl/worksheets/sheet1.xml")).toMatch(/state="frozen"/);
    expect(book.strings(2)).toEqual(
      expect.arrayContaining([
        "Scope: Riga, plus risks you reported or own",
        "ISO/IEC 27001 2022",
        "Confidential: internal use",
      ]),
    );
  });

  it("writes a hint for an undecided requirement whose controls are used", async () => {
    const [first] = soaFixture().rows;
    if (!first) throw new Error("fixture");
    const strings = readXlsx(
      await soaXlsx(
        soaFixture([
          first,
          { ...first, decision: null },
          { ...first, decision: null, hint: { kind: "used", refs: ["R-0003"], hiddenCount: 2 } },
          { ...first, decision: null, hint: { kind: "used", refs: [], hiddenCount: 1 } },
        ]),
      ),
    ).strings(1);
    expect(strings).toContain("Used by R-0001");
    expect(strings).toContain("Used by R-0003, and 2 risks outside your scope");
    expect(strings).toContain("Used by 1 risk outside your scope");
    expect(strings.filter((s) => s.startsWith("Used by"))).toHaveLength(3);
  });

  it("adds no group columns for a flat framework", async () => {
    const book = readXlsx(await soaXlsx(soaFixture()));
    expect(book.strings(1).slice(0, 2)).toEqual(["Reference", "Title"]);
    expect(book.xml("xl/worksheets/sheet1.xml")).toContain('<autoFilter ref="A1:I3"/>');
  });

  it("adds Function and Category columns for NIST CSF", async () => {
    const book = readXlsx(await soaXlsx(soaGroupedFixture()));
    const strings = book.strings(1);
    expect(strings.slice(0, 4)).toEqual(["Function", "Category", "Reference", "Title"]);
    expect(book.xml("xl/worksheets/sheet1.xml")).toContain('<autoFilter ref="A1:K5"/>');
    const row = strings.indexOf("GV.OC-01");
    expect(strings.slice(row - 2, row)).toEqual(["GV Govern", "GV.OC Organisational context"]);
    expect(strings).toContain("ID.AM Asset management");
  });

  it("adds a Theme column for ISO 27001", async () => {
    const strings = readXlsx(await soaXlsx(soaThemedFixture())).strings(1);
    expect(strings.slice(0, 2)).toEqual(["Theme", "Reference"]);
    expect(strings).toContain("A.5 Organisational controls");
    expect(strings).toContain("A.8 Technological controls");
  });

  it("names the Other requirements group by its title alone", async () => {
    const strings = readXlsx(await soaXlsx(soaOtherFixture())).strings(1);
    expect(strings).toContain("OLD-1");
    expect(strings).toContain("Other requirements");
    expect(strings.some((s) => s.startsWith("_other"))).toBe(false);
  });

  it("adds a Family column for NIST SP 800-53", async () => {
    const framework = {
      key: "nist-sp800-53-r5",
      name: "NIST SP 800-53",
      versionLabel: "Rev. 5 (Moderate baseline)",
    };
    const fixture = {
      ...soaThemedFixture(),
      framework,
      frameworks: [framework],
      groups: [
        { key: "AC", title: "Access control", parentKey: null, decided: 1, total: 1 },
        {
          key: "SC",
          title: "System and communications protection",
          parentKey: null,
          decided: 0,
          total: 1,
        },
      ],
      rows: [
        soaRow({ ref: "AC-2", groupKey: "AC" }),
        soaRow({ ref: "SC-7", groupKey: "SC", decision: null, hint: { kind: "unused" } }),
      ],
    };
    const strings = readXlsx(await soaXlsx(fixture)).strings(1);
    expect(strings.slice(0, 2)).toEqual(["Family", "Reference"]);
    expect(strings).toContain("AC Access control");
    expect(strings).toContain("SC System and communications protection");
  });

  it("adds a Chapter column for the EU AI Act", async () => {
    const framework = {
      key: "eu-ai-act-2024-1689",
      name: "EU AI Act",
      versionLabel: "Regulation (EU) 2024/1689",
    };
    const fixture = {
      ...soaThemedFixture(),
      framework,
      frameworks: [framework],
      groups: [
        { key: "III", title: "High-risk AI systems", parentKey: null, decided: 1, total: 1 },
      ],
      rows: [soaRow({ ref: "Art. 26(1)", groupKey: "III" })],
    };
    const strings = readXlsx(await soaXlsx(fixture)).strings(1);
    expect(strings.slice(0, 2)).toEqual(["Chapter", "Reference"]);
    expect(strings).toContain("III High-risk AI systems");
  });

  it("quotes a group cell that could read as a formula", async () => {
    const fixture = soaThemedFixture();
    fixture.groups = fixture.groups.map((g) => ({ ...g, key: `=${g.key}` }));
    fixture.rows = fixture.rows.map((r) => ({ ...r, groupKey: `=${r.groupKey ?? ""}` }));
    const strings = readXlsx(await soaXlsx(fixture)).strings(1);
    expect(strings).toContain("'=A.5 Organisational controls");
  });
});
