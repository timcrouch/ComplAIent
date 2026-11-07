import { describe, expect, it } from "vitest";
import { numbersIn, unknownNumberTokens } from "../src/index.js";

describe("number guard edge cases", () => {
  it("does not treat hyphenated double- compounds as multipliers", () => {
    expect(unknownNumberTokens("double-check the control", [])).toEqual([]);
    expect(unknownNumberTokens("a double-digit, double-click, double-sided", [])).toEqual([]);
    expect(unknownNumberTokens("double the rate; it will double", [])).toEqual(["double"]);
  });
  it("allows whitespace before ×", () => {
    expect(unknownNumberTokens("up 10 × and 5 ×", [10, 5])).toEqual(["10 ×", "5 ×"]);
  });
  it("always reports doubled, tripled, trebled, halved, quadrupled", () => {
    expect(unknownNumberTokens("it doubled, tripled, trebled, halved, quadrupled", [])).toEqual([
      "doubled",
      "tripled",
      "trebled",
      "halved",
      "quadrupled",
    ]);
    expect(numbersIn("it doubled")).toEqual([]);
  });
  it("reads a space-separated tens-and-unit as one number", () => {
    expect(numbersIn("twenty one risks")).toEqual([21]);
    expect(numbersIn("Ninety Nine and forty-two")).toEqual([99, 42]);
    expect(numbersIn("twenty risks")).toEqual([20]);
  });
  it("scales spaced suffixes except a lowercase m", () => {
    expect(numbersIn("10 K, 10 k, 2 bn, 3 billion, 4 thousand, 5 million")).toEqual([
      10000, 10000, 2e9, 3e9, 4000, 5e6,
    ]);
    expect(numbersIn("10 M")).toEqual([1e7]);
    expect(numbersIn("5 m of cable")).toEqual([5]);
    expect(numbersIn("5m")).toEqual([5e6]);
  });
});
