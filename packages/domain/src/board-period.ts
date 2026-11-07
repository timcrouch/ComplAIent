import { isoDateUtc } from "./review.js";

const DAY_MS = 86_400_000;
const MONTH_COUNT = 6;

export type BoardPeriod = { key: string; start: string; end: string }; // ISO dates, end inclusive

/** "last-30-days" and the last 6 full calendar months ("2026-10" …), newest first, in UTC. */
export function boardPeriods(now: Date): BoardPeriod[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const periods: BoardPeriod[] = [
    {
      key: "last-30-days",
      start: isoDateUtc(new Date(today - 29 * DAY_MS)),
      end: isoDateUtc(new Date(today)),
    },
  ];
  for (let back = 1; back <= MONTH_COUNT; back += 1) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    periods.push({
      key: isoDateUtc(first).slice(0, 7),
      start: isoDateUtc(first),
      end: isoDateUtc(last),
    });
  }
  return periods;
}

/** The default: the last full calendar month. */
export function defaultBoardPeriod(now: Date): BoardPeriod {
  return boardPeriods(now)[1] as BoardPeriod;
}

export function boardPeriodByKey(now: Date, key: string): BoardPeriod | null {
  return boardPeriods(now).find((p) => p.key === key) ?? null;
}

/**
 * The period of the same kind just before `p`: the month before a month, or the 30 days before
 * "last-30-days" (key "prev-30-days"), so a period fact can be compared with records.
 */
export function previousBoardPeriod(p: BoardPeriod): BoardPeriod {
  const start = Date.parse(`${p.start}T00:00:00Z`);
  if (p.key === "last-30-days")
    return {
      key: "prev-30-days",
      start: isoDateUtc(new Date(start - 30 * DAY_MS)),
      end: isoDateUtc(new Date(start - DAY_MS)),
    };
  const first = new Date(start);
  const prevFirst = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
  return {
    key: isoDateUtc(prevFirst).slice(0, 7),
    start: isoDateUtc(prevFirst),
    end: isoDateUtc(new Date(start - DAY_MS)),
  };
}
