const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * A calendar date for people, British style: "5 November 2026". `timeZone` is the viewer's
 * zone (lib/greeting.ts resolveTimeZone), so the day shown is the viewer's own day.
 */
export function formatDate(iso: string, timeZone: string): string {
  let format = cache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    });
    cache.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** A calendar month for people: "October 2026", from an ISO date in that month (UTC). */
export function formatMonth(isoDate: string): string {
  return monthFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`));
}
