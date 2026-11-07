import type { Dice } from "./random.js";

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export const startOfDay = (ms: number): number => Math.floor(ms / DAY) * DAY;
/** YYYY-MM-DD in UTC. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** A `@db.Date` value: UTC midnight of a YYYY-MM-DD string. */
export const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The last two weeks of December, when the sample company is on holiday. */
export const isHoliday = (ms: number): boolean => {
  const d = new Date(ms);
  return d.getUTCMonth() === 11 && d.getUTCDate() >= 18;
};

const isWeekend = (ms: number): boolean => {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
};

/**
 * Times of the sample year: whole UTC days before today plus a seeded minute in working hours,
 * so the plan depends on the day of `now` only. Nothing is placed on or after today.
 */
export type Timeline = {
  today0: number;
  /** A working-hours time `daysAgo` days before today. */
  onDay: (daysAgo: number) => number;
  /**
   * A time `min`..`max` days after `t` (0 = later the same day), moved off weekends and out of
   * the December holiday; null when it would not be before today.
   */
  later: (t: number, min: number, max: number) => number | null;
};

export function timeline(now: Date, d: Dice): Timeline {
  const today0 = startOfDay(now.getTime());
  const workMinute = () => d.int(7 * 60 + 30, 17 * 60);
  const settle = (ms: number): number => {
    let t = ms;
    if (isHoliday(t)) {
      const year = new Date(t).getUTCFullYear();
      t = Date.UTC(year + 1, 0, 2) + (t - startOfDay(t));
    }
    while (isWeekend(t)) t += DAY;
    return t;
  };
  return {
    today0,
    onDay: (daysAgo) => today0 - daysAgo * DAY + workMinute() * MINUTE,
    later: (t, min, max) => {
      const days = d.int(min, max);
      let next =
        days === 0
          ? t + d.int(10, 120) * MINUTE
          : settle(startOfDay(t) + days * DAY) + workMinute() * MINUTE;
      if (next <= t) next = t + d.int(5, 60) * MINUTE;
      return next < today0 ? next : null;
    },
  };
}
