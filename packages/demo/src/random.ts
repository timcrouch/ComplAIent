/** A seeded random source: mulberry32, uniform in [0, 1). Same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Helpers over one random source, so every draw comes from the same seeded sequence. */
export type Dice = {
  next: () => number;
  /** An integer in [min, max], both included. */
  int: (min: number, max: number) => number;
  chance: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** One item, chosen with the given relative weights. */
  weighted: <T>(items: readonly (readonly [T, number])[]) => T;
};

export function dice(next: () => number): Dice {
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("pick from an empty list");
    return items[int(0, items.length - 1)] as T;
  };
  const weighted = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = next() * total;
    for (const [item, w] of items) {
      roll -= w;
      if (roll < 0) return item;
    }
    return pick(items)[0];
  };
  return { next, int, chance: (p) => next() < p, pick, weighted };
}
