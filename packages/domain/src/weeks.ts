const DAY_MS = 86_400_000;

/** The Monday (UTC) of d's week as YYYY-MM-DD. */
export function weekStartUtc(d: Date): string {
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The `count` Monday week starts ending with the week containing `end` (YYYY-MM-DD), oldest first. */
export function weekStartsEnding(end: string, count: number): string[] {
  const current = Date.parse(`${weekStartUtc(new Date(`${end}T00:00:00Z`))}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(current - (count - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
  );
}

/** The `count` week starts ending with now's week, oldest first. */
export function recentWeekStarts(now: Date, count: number): string[] {
  return weekStartsEnding(now.toISOString().slice(0, 10), count);
}
