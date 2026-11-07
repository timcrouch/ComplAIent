/**
 * Time-of-day greeting in the user's own time zone.
 *
 * The server renders the greeting, so it needs the user's zone. A tiny inline script in the
 * root layout (`timeZoneScript`) stores `Intl.DateTimeFormat().resolvedOptions().timeZone` in
 * the `isms_tz` cookie on every page load. The server reads it; if it is missing (the very first
 * page view) or invalid, UTC is used. Server and client never compute the greeting separately,
 * so there is no hydration mismatch.
 */

export const TIME_ZONE_COOKIE = "isms_tz";
const MAX_ZONE_LENGTH = 64;

export type DayPeriod = "morning" | "afternoon" | "evening";

/** 05:00–11:59 morning, 12:00–17:59 afternoon, otherwise evening. */
export function dayPeriod(now: Date, timeZone: string): DayPeriod {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** A valid IANA zone from the cookie value, or "UTC". */
export function resolveTimeZone(value: string | undefined): string {
  if (!value || value.length > MAX_ZONE_LENGTH * 3) return "UTC";
  let zone: string;
  try {
    zone = decodeURIComponent(value);
  } catch {
    return "UTC";
  }
  if (zone.length > MAX_ZONE_LENGTH || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The first word of the display name ("Anna Admin" → "Anna"), or "". */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/, 1)[0] ?? "";
}

/** Inline script for <head>: records the browser's time zone for the next server render. */
export const timeZoneScript =
  `try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;` +
  `if(z)document.cookie="${TIME_ZONE_COOKIE}="+encodeURIComponent(z)+` +
  `";path=/;max-age=31536000;samesite=lax"+(location.protocol==="https:"?";secure":"")}catch(e){}`;
