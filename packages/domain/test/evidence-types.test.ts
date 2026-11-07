import { describe, expect, it } from "vitest";
import { EVIDENCE_TYPES, detectEvidenceType } from "../src/index.js";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("detectEvidenceType", () => {
  it("lists the nine allowed types", () => {
    expect(Object.keys(EVIDENCE_TYPES)).toHaveLength(9);
  });
  it("accepts a real PDF head for application/pdf with .pdf", () => {
    expect(detectEvidenceType(ascii("%PDF-1.7\n"), PDF, "Report.PDF")).toEqual({
      ok: true,
      mime: PDF,
    });
  });
  it("refuses an MZ executable head declared as application/pdf", () => {
    expect(detectEvidenceType(bytes(0x4d, 0x5a, 0x90, 0, 3), PDF, "a.pdf")).toEqual({
      ok: false,
      reason: "evidenceTypeNotAllowed",
    });
  });
  it("refuses a PNG head declared as image/jpeg", () => {
    expect(
      detectEvidenceType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        "image/jpeg",
        "a.jpg",
      ).ok,
    ).toBe(false);
  });
  it("accepts png, jpeg, webp, zip", () => {
    expect(
      detectEvidenceType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        "image/png",
        "a.png",
      ).ok,
    ).toBe(true);
    expect(detectEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg", "a.jpeg").ok).toBe(true);
    expect(detectEvidenceType(ascii("RIFF\0\0\0\0WEBPVP8 "), "image/webp", "a.webp").ok).toBe(true);
    expect(detectEvidenceType(bytes(0x50, 0x4b, 3, 4, 0), DOCX, "a.docx").ok).toBe(true);
  });
  it("refuses RIFF without WEBP", () => {
    expect(detectEvidenceType(ascii("RIFF\0\0\0\0WAVEfmt "), "image/webp", "a.webp").ok).toBe(
      false,
    );
  });
  it("accepts utf-8 text and csv", () => {
    expect(detectEvidenceType(ascii("héllo"), "text/plain", "a.txt").ok).toBe(true);
    expect(detectEvidenceType(ascii("a,b\n1,2"), "text/csv", "a.csv").ok).toBe(true);
  });
  it("tolerates a head cut mid-character", () => {
    const e = new TextEncoder().encode("ab€");
    expect(detectEvidenceType(e.slice(0, e.length - 1), "text/plain", "a.txt").ok).toBe(true);
  });
  it("refuses invalid utf-8 text", () => {
    expect(detectEvidenceType(bytes(0x61, 0xff, 0xfe, 0x62), "text/plain", "a.txt").ok).toBe(false);
  });
  it("refuses text/plain containing a NUL byte", () => {
    expect(detectEvidenceType(bytes(0x61, 0, 0x62), "text/plain", "a.txt").ok).toBe(false);
  });
  it("refuses a .docx name declared as text/plain", () => {
    expect(detectEvidenceType(ascii("hello"), "text/plain", "a.docx").ok).toBe(false);
  });
  it("refuses an unknown MIME and a missing extension", () => {
    expect(detectEvidenceType(ascii("x"), "application/x-msdownload", "a.exe").ok).toBe(false);
    expect(detectEvidenceType(ascii("%PDF-"), PDF, "noext").ok).toBe(false);
  });
});
