import { describe, expect, it } from "vitest";
import { toCsv } from "../lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines and ends lines with CRLF", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"']])).toBe('\uFEFFa,b\r\n"x,y","say ""hi"""\r\n');
  });

  it("quotes a field with a line break of either kind", () => {
    expect(toCsv(["h"], [["one\ntwo"], ["one\r\ntwo"]])).toBe(
      '\uFEFFh\r\n"one\ntwo"\r\n"one\r\ntwo"\r\n',
    );
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])(
    "neutralises formula-like cell %j",
    (v) => {
      expect(toCsv(["h"], [[v]]).split("\r\n")[1]).toMatch(/^"?'/);
    },
  );

  it("neutralises a formula-like header too, and leaves ordinary text alone", () => {
    expect(toCsv(["=h", "A.8.13"], [["Back-ups", "3 - 1"]])).toBe(
      "\uFEFF'=h,A.8.13\r\nBack-ups,3 - 1\r\n",
    );
  });

  it("writes only the header when there are no rows", () => {
    expect(toCsv(["a"], [])).toBe("\uFEFFa\r\n");
  });
});
