export const MIN_REVIEW_INTERVAL_MONTHS = 1;
export const MAX_REVIEW_INTERVAL_MONTHS = 36;
export const DEFAULT_REVIEW_INTERVAL_MONTHS = 12;

/** YYYY-MM-DD of d in UTC. */
export function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** from (a UTC instant) + months, as YYYY-MM-DD; clamps to the target month's last day. */
export function reviewDueDate(from: Date, months: number): string {
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDay);
  return isoDateUtc(new Date(Date.UTC(year, month, day)));
}

/** due <= today (both YYYY-MM-DD). */
export function isReviewDue(due: string, today: string): boolean {
  return due <= today;
}
