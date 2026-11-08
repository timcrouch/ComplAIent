import type { BoardPackResponse } from "@isms/contracts";
import { formatDate, formatMonth } from "../../lib/dates";

/**
 * A board period in words: a month key ("2026-10") is "October 2026", the rolling period is
 * `last30Days` ("the last 30 days"), anything else its dates.
 */
/**
 * A month that ended the day before the pack was generated (the pack is from the 1st), so it
 * is too soon for its summary to be approved (#8). `generatedAt` is UTC, like the periods.
 */
export function endedYesterday(period: BoardPackResponse["period"], generatedAt: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period.key)) return false;
  const next = new Date(Date.parse(`${period.end}T00:00:00.000Z`) + 86_400_000);
  return generatedAt.slice(0, 10) === next.toISOString().slice(0, 10);
}

export function periodName(period: BoardPackResponse["period"], last30Days: string): string {
  if (/^\d{4}-\d{2}$/.test(period.key)) return formatMonth(period.start);
  if (period.key === "last-30-days") return last30Days;
  return `${formatDate(`${period.start}T00:00:00.000Z`, "UTC")} to ${formatDate(`${period.end}T00:00:00.000Z`, "UTC")}`;
}
