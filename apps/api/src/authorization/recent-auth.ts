import { DomainError } from "@isms/domain";

/** Sensitive actions need an interactive sign-in no older than this. */
export const RECENT_AUTH_WINDOW_S = 300;

/** True when `authTime` (epoch seconds) is at most RECENT_AUTH_WINDOW_S before `now`. */
export function isRecentAuth(authTime: number, now: Date): boolean {
  return now.getTime() / 1000 - authTime <= RECENT_AUTH_WINDOW_S;
}

export const recentAuthRequired = (): DomainError =>
  new DomainError("RECENT_AUTH_REQUIRED", "Please sign in again to continue");
