import { describe, expect, it } from "vitest";
import { DomainError, riskJourney } from "../src/index.js";
import type { RiskState, StateChange } from "../src/index.js";

const ch = (state: RiskState, day: number, by: string): StateChange => ({
  state,
  at: new Date(Date.UTC(2026, 10, day)),
  by,
});

describe("riskJourney", () => {
  it("fresh report", () => {
    const j = riskJourney([ch("proposed", 1, "a")]);
    expect(j.steps.map((s) => s.status)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(j.steps[0]).toMatchObject({ key: "reported", by: "a" });
    expect(j.steps[1]?.at).toEqual(ch("proposed", 1, "a").at);
    expect(j.steps[2]).toMatchObject({ at: null, by: null });
    expect(j.since).toEqual(ch("proposed", 1, "a").at);
    expect(j.returnCount).toBe(0);
  });
  it("in review", () => {
    const j = riskJourney([ch("proposed", 1, "a"), ch("in_review", 2, "b")]);
    expect(j.steps.map((s) => s.status)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(j.steps[1]).toMatchObject({ by: "b", at: ch("in_review", 2, "b").at });
    expect(j.steps[2]).toMatchObject({ by: "b", at: ch("in_review", 2, "b").at });
  });
  it("returned shows under_review current from the return", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("returned", 3, "c"),
    ]);
    expect(j.steps.map((s) => s.status)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(j.steps[1]).toMatchObject({ by: "c", at: ch("returned", 3, "c").at });
    expect(j.returnCount).toBe(1);
  });
  it("approved after two returns", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("returned", 3, "c"),
      ch("in_review", 4, "b"),
      ch("returned", 5, "c"),
      ch("in_review", 6, "b"),
      ch("approved", 7, "boss"),
    ]);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "done", "current", "upcoming"]);
    expect(j.steps[3]).toMatchObject({ by: "boss", at: ch("approved", 7, "x").at });
    expect(j.steps[2]).toMatchObject({ at: ch("approved", 7, "x").at });
    expect(j.steps[1]).toMatchObject({ at: ch("in_review", 6, "b").at });
    expect(j.returnCount).toBe(2);
    expect(j.since).toEqual(ch("approved", 7, "x").at);
  });
  it("throws on empty", () => {
    expect(() => riskJourney([])).toThrow(DomainError);
  });

  it("fresh risk is first cycle with closed upcoming", () => {
    const j = riskJourney([ch("proposed", 1, "a")]);
    expect(j.cycle).toBe("first");
    expect(j.steps.map((s) => s.key)).toEqual([
      "reported",
      "under_review",
      "awaiting_approval",
      "approved",
      "closed",
    ]);
    expect(j.steps[4]).toMatchObject({ status: "upcoming", at: null, by: null });
  });
  it("approved risk has closed upcoming", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("approved", 3, "c"),
    ]);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "done", "current", "upcoming"]);
  });
  it("closed: approved done, closed current", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("approved", 3, "c"),
      ch("closed", 4, "d"),
    ]);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "current"]);
    expect(j.steps[3]).toMatchObject({ by: "c", at: ch("approved", 3, "x").at });
    expect(j.steps[4]).toMatchObject({ by: "d", at: ch("closed", 4, "x").at });
    expect(j.since).toEqual(ch("closed", 4, "x").at);
    expect(j.cycle).toBe("first");
  });
  it("reassessed cycle ignores earlier returns", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("returned", 3, "c"),
      ch("in_review", 4, "b"),
      ch("approved", 5, "boss"),
      ch("proposed", 6, "r"),
      ch("in_review", 7, "s"),
      ch("returned", 8, "t"),
      ch("in_review", 9, "s"),
      ch("approved", 10, "boss2"),
    ]);
    expect(j.cycle).toBe("reassessed");
    expect(j.returnCount).toBe(1);
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done", "done", "current", "upcoming"]);
    expect(j.steps[0]).toMatchObject({ by: "r", at: ch("proposed", 6, "x").at });
    expect(j.steps[3]).toMatchObject({ by: "boss2" });
    expect(j.cycleStart).toEqual(ch("proposed", 6, "x").at);
  });
  it("reassess from closed starts a new cycle", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("approved", 3, "c"),
      ch("closed", 4, "d"),
      ch("proposed", 5, "e"),
    ]);
    expect(j.cycle).toBe("reassessed");
    expect(j.steps.map((s) => s.status)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(j.steps[0]).toMatchObject({ by: "e" });
  });
  it("a return to proposed-like state in the first cycle stays first", () => {
    const j = riskJourney([
      ch("proposed", 1, "a"),
      ch("in_review", 2, "b"),
      ch("returned", 3, "c"),
    ]);
    expect(j.cycle).toBe("first");
    expect(j.cycleStart).toEqual(ch("proposed", 1, "x").at);
  });
});
