import { describe, expect, it } from "vitest";
import { CONCERN_RANKS, concernBadgeOccurrences, concernRank, scoreConcern } from "../src/index.js";

describe("concern reward policy", () => {
  it("combines fixed legitimacy, severity and reporting-position points", () => {
    expect(scoreConcern({ legitimacy: "confirmed", severity: "critical", position: 1 })).toEqual({
      legitimacyPoints: 100,
      severityPoints: 100,
      positionPoints: 50,
      total: 250,
    });
    expect(
      scoreConcern({ legitimacy: "confirmed_duplicate", severity: "moderate", position: 5 }),
    ).toEqual({ legitimacyPoints: 100, severityPoints: 25, positionPoints: 5, total: 130 });
    expect(
      scoreConcern({ legitimacy: "out_of_scope", severity: "informational", position: 6 }),
    ).toEqual({ legitimacyPoints: 0, severityPoints: 0, positionPoints: 0, total: 0 });
    expect(scoreConcern({ legitimacy: "not_confirmed", severity: "major", position: 1 })).toEqual({
      legitimacyPoints: 0,
      severityPoints: 0,
      positionPoints: 0,
      total: 0,
    });
  });

  it("rejects invalid duplicate positions", () => {
    expect(() => scoreConcern({ legitimacy: "confirmed", severity: "minor", position: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      scoreConcern({ legitimacy: "confirmed", severity: "minor", position: 1.5 }),
    ).toThrow(RangeError);
  });

  it("moves through the five ranks using lifetime points", () => {
    expect(CONCERN_RANKS.map((rank) => rank.label)).toEqual([
      "Recruit",
      "Defender",
      "Protector",
      "Guardian",
      "Security Vanguard",
    ]);
    expect(concernRank(-10).key).toBe("recruit");
    expect(concernRank(249).key).toBe("recruit");
    expect(concernRank(250).key).toBe("defender");
    expect(concernRank(749).key).toBe("defender");
    expect(concernRank(750).key).toBe("protector");
    expect(concernRank(1_500).key).toBe("guardian");
    expect(concernRank(3_000).key).toBe("security_vanguard");
  });

  it("counts repeatable achievements per evaluation and milestones only once", () => {
    const evaluations = [
      ["e1", "confirmed", "critical", 1, "2026-01-01"],
      ["e2", "confirmed", "major", 1, "2026-01-02"],
      ["e3", "confirmed", "moderate", 1, "2026-02-01"],
      ["e4", "confirmed_duplicate", "moderate", 2, "2026-03-01"],
      ["e5", "plausible", "minor", 1, "2026-03-02"],
      ["e6", "confirmed_duplicate", "minor", 3, "2026-04-01"],
    ] as const;
    const occurrences = concernBadgeOccurrences(
      evaluations.map(([id, legitimacy, severity, position, createdAt]) => ({
        id,
        legitimacy,
        severity,
        position,
        createdAt: new Date(`${createdAt}T00:00:00Z`),
      })),
    );
    const count = (key: string) =>
      occurrences.filter((occurrence) => occurrence.badgeKey === key).length;
    expect(count("first_signal")).toBe(3);
    expect(count("high_impact")).toBe(2);
    expect(count("corroborator")).toBe(2);
    expect(count("sharp_eye")).toBe(1);
    expect(count("early_warning")).toBe(1);
    expect(count("consistent_guardian")).toBe(1);
  });
});
