import { describe, expect, it } from "vitest";
import { cleanFileName, contentDisposition } from "../../src/evidence/file-check.js";

describe("cleanFileName", () => {
  it.each([
    ["../../etc/passwd.pdf", "passwd.pdf"],
    ["a\u202Egnp.pdf", "agnp.pdf"],
    ["  ", "evidence"],
    ["C:\\x\\report.pdf", "report.pdf"],
  ])("cleans %j to %j", (raw, clean) => {
    expect(cleanFileName(raw)).toBe(clean);
  });

  it("collapses whitespace and removes control characters", () => {
    expect(cleanFileName("  Access\t review\u0000  2026 .pdf ")).toBe("Access review 2026 .pdf");
    expect(cleanFileName("a\u200Bb\uFEFF.txt")).toBe("ab.txt");
  });

  it("cuts long names to 200 characters and keeps the extension", () => {
    const cleaned = cleanFileName(`${"x".repeat(300)}.xlsx`);
    expect(cleaned).toHaveLength(200);
    expect(cleaned.endsWith(".xlsx")).toBe(true);
    expect(cleanFileName("y".repeat(250))).toHaveLength(200);
  });

  it("a name that is only a path or invisible characters becomes evidence", () => {
    expect(cleanFileName("dir/")).toBe("evidence");
    expect(cleanFileName("\u202E\u200B")).toBe("evidence");
  });
});

describe("contentDisposition", () => {
  it("is always an attachment with an RFC 5987 UTF-8 name", () => {
    expect(contentDisposition("Prüfbericht 1.pdf")).toBe(
      "attachment; filename*=UTF-8''Pr%C3%BCfbericht%201.pdf",
    );
    expect(contentDisposition("a'(b)*.txt")).toBe(
      "attachment; filename*=UTF-8''a%27%28b%29%2A.txt",
    );
  });
});
