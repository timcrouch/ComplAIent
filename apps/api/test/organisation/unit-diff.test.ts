import { describe, expect, it } from "vitest";
import { diffUnits } from "../../src/organisation/unit-diff.js";

type Stored = { id: string; name: string };
type Input = { id?: string; name: string };
const same = (s: Stored, i: Input) => s.name === i.name;

describe("diffUnits", () => {
  const stored: Stored[] = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("creates entries without id, updates changed ones, removes unlisted ones", () => {
    const diff = diffUnits(
      "sites",
      stored,
      [{ id: "a", name: "A" }, { id: "b", name: "B2" }, { name: "D" }],
      same,
    );
    expect(diff.invalid).toEqual([]);
    expect(diff.create).toEqual([{ name: "D" }]);
    expect(diff.update).toEqual([{ stored: stored[1], input: { id: "b", name: "B2" } }]);
    expect(diff.remove).toEqual([stored[2]]);
  });

  it("reports unknown and repeated ids at their index", () => {
    const diff = diffUnits(
      "departments",
      stored,
      [
        { id: "a", name: "A" },
        { id: "zzz", name: "Z" },
        { id: "a", name: "A again" },
      ],
      same,
    );
    expect(diff.invalid.map((d) => d.path)).toEqual(["departments.1.id", "departments.2.id"]);
  });
});
