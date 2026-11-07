import { describe, expect, it } from "vitest";
import { numbersIn, unknownNumbers } from "../src/index.js";

describe("numbersIn", () => {
  it("reads integers, decimals, separators, references and percentages", () => {
    expect(numbersIn("3 risks, 12.5% and 1,200 items; R-0003")).toEqual([3, 12.5, 1200, 3]);
  });
  it("returns nothing for text without digits", () => {
    expect(numbersIn("No change.")).toEqual([]);
  });
  it("treats a minus sign as a separator (absolute values)", () => {
    expect(numbersIn("fell by -5 points")).toEqual([5]);
  });
  it("splits dates and times into their parts", () => {
    expect(numbersIn("on 2026-10-31")).toEqual([2026, 10, 31]);
    expect(numbersIn("at 14:05")).toEqual([14, 5]);
  });
  it("handles multi-group thousands and decimals with separators", () => {
    expect(numbersIn("1,234,567.89 EUR")).toEqual([1234567.89]);
  });
  it("does not treat a sentence-ending period as a decimal point", () => {
    expect(numbersIn("There are 12.")).toEqual([12]);
  });
  it("treats a comma not followed by three digits as a separator", () => {
    expect(numbersIn("3,4 and 12,34")).toEqual([3, 4, 12, 34]);
  });
});

describe("unknownNumbers", () => {
  it("returns numbers not in the allowed list", () => {
    expect(unknownNumbers("5 open, 40% up", [5])).toEqual([40]);
  });
  it("returns empty when there are no numbers", () => {
    expect(unknownNumbers("No change.", [])).toEqual([]);
  });
  it("deduplicates in order of appearance", () => {
    expect(unknownNumbers("9 then 7 then 9 then 7", [])).toEqual([9, 7]);
  });
});
