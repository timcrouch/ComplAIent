import { describe, expect, it } from "vitest";
import { rng } from "../src/random.js";
import { uuidv7At } from "../src/uuid7.js";

const take = (next: () => number, n: number) => Array.from({ length: n }, () => next());

describe("rng", () => {
  it("is deterministic for a seed", () => {
    expect(take(rng(42), 20)).toEqual(take(rng(42), 20));
  });

  it("gives numbers in [0, 1) that differ between seeds", () => {
    const a = take(rng(42), 1000);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(take(rng(43), 20)).not.toEqual(a.slice(0, 20));
    expect(new Set(a).size).toBeGreaterThan(990);
  });
});

describe("uuidv7At", () => {
  const at = new Date("2026-03-04T05:06:07.089Z");

  it("is deterministic for the same time and random source", () => {
    expect(uuidv7At(at, rng(1))).toBe(uuidv7At(at, rng(1)));
  });

  it("is a version 7, RFC 9562 variant UUID", () => {
    expect(uuidv7At(at, rng(1))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("encodes the millisecond timestamp in the first 48 bits", () => {
    const hex = uuidv7At(at, rng(1)).replace(/-/g, "").slice(0, 12);
    expect(Number.parseInt(hex, 16)).toBe(at.getTime());
  });

  it("sorts by time", () => {
    const rand = rng(7);
    const times = [0, 1, 2, 1000, 86_400_000, 31_536_000_000].map(
      (ms) => new Date(at.getTime() + ms),
    );
    const ids = [...times].reverse().map((t) => uuidv7At(t, rand));
    expect([...ids].sort()).toEqual([...ids].reverse());
  });

  it("orders ids of one millisecond by the sequence number", () => {
    const rand = rng(9);
    const ids = [0, 1, 2, 3].map((seq) => uuidv7At(at, rand, seq));
    expect([...ids].sort()).toEqual(ids);
  });
});
