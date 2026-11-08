import { describe, expect, it } from "vitest";
import { type NarrativeFacts, narrativeText } from "../src/texts.js";

const facts = (over: Partial<NarrativeFacts> = {}): NarrativeFacts => ({
  month: 9,
  approved: 0,
  treated: 0,
  reviewed: 0,
  tested: 0,
  gaps: 0,
  accepted: 0,
  ...over,
});

describe("narrativeText agrees in number with what happened (#8)", () => {
  it.each([
    [
      { approved: 1, treated: 1 },
      "Risk management stayed on course in October: a risk was assessed and approved, and another was marked as treated.",
    ],
    [
      { approved: 3, treated: 2 },
      "Risk management stayed on course in October: risks were assessed and approved, and others were marked as treated.",
    ],
    [
      { approved: 1 },
      "Risk management stayed on course in October: a risk was assessed and approved.",
    ],
    [
      { approved: 2 },
      "Risk management stayed on course in October: risks were assessed and approved.",
    ],
    [{ treated: 1 }, "October brought no new approvals, but a risk was marked as treated."],
    [{ treated: 4 }, "October brought no new approvals, but some risks were marked as treated."],
    [{}, "October was a quiet month for risk decisions."],
  ])("opening for %j", (over, opening) => {
    expect(narrativeText(facts(over), 0)).toContain(opening);
  });

  it.each([
    [1, "A periodic review of an older risk was carried out."],
    [3, "Periodic reviews of older risks were carried out."],
  ])("%i review(s)", (reviewed, sentence) => {
    expect(narrativeText(facts({ reviewed }), 0)).toContain(sentence);
  });

  it.each([
    [{ tested: 1, gaps: 0 }, "The control tested this month worked as designed."],
    [{ tested: 4, gaps: 0 }, "The controls tested this month worked as designed."],
    [{ tested: 4, gaps: 1 }, "A control test found a gap, which now has an action."],
    [{ tested: 4, gaps: 2 }, "Control tests found gaps, which now have actions."],
  ])("control tests %j", (over, sentence) => {
    expect(narrativeText(facts(over), 0)).toContain(sentence);
  });

  it("names no test result when nothing was tested", () => {
    expect(narrativeText(facts(), 0)).not.toMatch(/control/i);
  });

  it.each([
    [0, "The board is asked to note the plan for the remaining open actions."],
    [
      1,
      "The board is asked to note the accepted risk and the plan for the remaining open actions.",
    ],
    [
      2,
      "The board is asked to note the accepted risks and the plan for the remaining open actions.",
    ],
  ])("%i accepted risk(s) in the closing", (accepted, closing) => {
    expect(narrativeText(facts({ accepted }), 1)).toContain(closing);
  });

  it("stays free of digits, which the app's figure check would refuse", () => {
    const text = narrativeText(
      facts({ approved: 7, treated: 5, reviewed: 9, tested: 6, gaps: 3 }),
      2,
    );
    expect(text).not.toMatch(/\d/);
  });
});
