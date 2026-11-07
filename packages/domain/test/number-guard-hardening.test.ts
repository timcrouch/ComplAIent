import { describe, expect, it } from "vitest";
import { numbersIn, unknownNumberTokens, unknownNumbers } from "../src/index.js";
import { boardPeriods, defaultBoardPeriod } from "../src/index.js";
import { implementationStatus } from "../src/index.js";

describe("normalisation", () => {
  it("maps fullwidth, Arabic-Indic and superscript digits to ASCII", () => {
    expect(numbersIn("１２ items")).toEqual([12]);
    expect(numbersIn("٣ and ٤٥")).toEqual([3, 45]);
    expect(numbersIn("𝟕 risks")).toEqual([7]);
    expect(numbersIn("10²")).toEqual([102]);
  });
});

describe("spelled-out numbers", () => {
  it("reads zero-nineteen, tens and hyphenated compounds, case-insensitively", () => {
    expect(numbersIn("Seventeen risks, FORTY-TWO controls, twenty, zero, ninety-one")).toEqual([
      17, 42, 20, 0, 91,
    ]);
  });
  it("excludes one, a and an", () => {
    expect(numbersIn("one risk, a control, an item")).toEqual([]);
  });
  it("reads scales, dozen, half and quarter", () => {
    expect(numbersIn("a hundred, thousand, million, billion")).toEqual([100, 1e3, 1e6, 1e9]);
    expect(numbersIn("a dozen, half, quarter")).toEqual([12, 0.5, 0.25]);
  });
  it("combines number words with scales", () => {
    expect(numbersIn("two hundred")).toEqual([200]);
    expect(numbersIn("three thousand risks")).toEqual([3000]);
    expect(numbersIn("two hundred thousand")).toEqual([200000]);
    expect(numbersIn("two dozen")).toEqual([24]);
  });
  it("matches whole words only", () => {
    expect(numbersIn("often tenant sixtyish")).toEqual([]);
  });
});

describe("magnitude suffixes", () => {
  it("scales k, m, bn and spelled magnitudes", () => {
    expect(numbersIn("5k and 5K")).toEqual([5000, 5000]);
    expect(numbersIn("2m, 2M, 2 million")).toEqual([2e6, 2e6, 2e6]);
    expect(numbersIn("3bn and 3 billion")).toEqual([3e9, 3e9]);
    expect(numbersIn("4 thousand")).toEqual([4000]);
    expect(numbersIn("4.35k")).toEqual([4350]);
  });
  it("does not scale on unrelated letters", () => {
    expect(numbersIn("12 months, 5mm")).toEqual([12, 5]);
  });
});

describe("comparative multipliers", () => {
  it("reports multiplier expressions even when the number is allowed", () => {
    expect(unknownNumberTokens("up 3x", [3])).toEqual(["3x"]);
    expect(unknownNumberTokens("up 3×", [3])).toEqual(["3×"]);
    expect(unknownNumberTokens("3 times more", [3])).toEqual(["3 times"]);
    expect(unknownNumberTokens("a 3-fold rise", [3])).toEqual(["3-fold"]);
    expect(unknownNumberTokens("it doubled, twice the rate, triple", [])).toEqual([
      "doubled",
      "twice",
      "triple",
    ]);
    expect(unknownNumberTokens("tenfold and five times", [10, 5])).toEqual([
      "tenfold",
      "five times",
    ]);
  });
  it("lists unknown numbers and deduplicates tokens", () => {
    expect(unknownNumberTokens("5 open, 40% up, 40 again", [5])).toEqual(["40"]);
    expect(unknownNumberTokens("No change.", [])).toEqual([]);
    expect(unknownNumberTokens("Forty-two and 5k", [42])).toEqual(["5k"]);
  });
  it("keeps unknownNumbers number-only", () => {
    expect(unknownNumbers("3x and 7", [3])).toEqual([7]);
    expect(unknownNumbers("two hundred and 5k", [200])).toEqual([5000]);
  });
});

describe("decimals and grouping", () => {
  it("reads a leading-dot decimal", () => {
    expect(numbersIn("about .5 of")).toEqual([0.5]);
    expect(numbersIn("version 1.2.3")).toEqual([1.2, 3]);
  });
  it("only groups exact thousands", () => {
    expect(numbersIn("1,2345")).toEqual([1, 2345]);
    expect(numbersIn("1,2000")).toEqual([1, 2000]);
  });
  it("yields both readings of dotted thousands", () => {
    expect(numbersIn("1.200")).toEqual([1200, 1.2]);
    expect(numbersIn("1.200,50")).toEqual([1200.5, 1.2, 50]);
    expect(numbersIn("1.200.000")).toEqual([1200000, 1.2, 0]);
    expect(unknownNumbers("1.200", [1200])).toEqual([1.2]);
    expect(unknownNumbers("1.200", [1200, 1.2])).toEqual([]);
    expect(numbersIn("1.2000")).toEqual([1.2]);
  });
});

describe("board period boundaries", () => {
  it("defaults to December of the prior year in January", () => {
    const now = new Date("2027-01-10T00:00:00Z");
    expect(defaultBoardPeriod(now)).toEqual({
      key: "2026-12",
      start: "2026-12-01",
      end: "2026-12-31",
    });
    expect(boardPeriods(now)[6]?.key).toBe("2026-07");
  });
  it("handles a 31-day month-end now", () => {
    const now = new Date("2026-10-31T23:59:59Z");
    expect(boardPeriods(now)[0]).toEqual({
      key: "last-30-days",
      start: "2026-10-02",
      end: "2026-10-31",
    });
    expect(defaultBoardPeriod(now)).toEqual({
      key: "2026-09",
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
  it("spans a month boundary in last-30-days", () => {
    expect(boardPeriods(new Date("2026-03-05T12:00:00Z"))[0]).toEqual({
      key: "last-30-days",
      start: "2026-02-04",
      end: "2026-03-05",
    });
  });
});

describe("implementationStatus with undefined result", () => {
  it("treats undefined as untested", () => {
    expect(implementationStatus({ acceptedOnRisks: 1, latestResult: undefined })).toBe(
      "implementedNotTested",
    );
  });
});
