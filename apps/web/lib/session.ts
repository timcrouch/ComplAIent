import "server-only";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { env } from "./env";
import { requestLog } from "./log";
import { ensureDiscovery, refresh, type Tokens } from "./oidc";
import { getStore } from "./redis";
import { deriveKeys, lookupDigest, seal, unseal, type Keys } from "./seal";

/**
 * Token rule: tokens never leave this module except as the return value of getAccessToken
 * (server-side API calls) and endSession (the ID token hint for the IdP logout redirect).
 * Pages and layouts get a SessionView, which carries no credentials, so nothing that is
 * rendered or passed to a client component can leak a token. `server-only` keeps this
 * module out of client bundles.
 */
type Session = Tokens & {
  /** Epoch ms of sign-in; kept across refreshes. */
  createdAt: number;
};

/** Token-free view of a session, safe to hand to layouts and pages. */
export type SessionView = {
  userSub: string;
  /** Epoch ms at which the session ends unless it is refreshed (refresh-token expiry). */
  expiresAt: number;
  /** Epoch ms at which the user signed in (the session was created). */
  createdAt: number;
};

const REFRESH_MARGIN_MS = 30_000;
/** Well above one IdP call (5 s timeout; discovery is done before locking). */
const LOCK_TTL_MS = 20_000;
const LOCK_POLL_MS = 50;
/** Longer than the lock TTL, so a waiter outlives a crashed lock holder. */
const LOCK_WAIT_MS = 25_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const schema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  idToken: z.string(),
  expiresAt: z.number(),
  refreshExpiresAt: z.number(),
  userSub: z.string(),
  // Sessions written before createdAt existed count as old.
  createdAt: z.number().default(0),
});

let keys: Keys | undefined;
const sessionKeys = (): Keys => (keys ??= deriveKeys(env().SESSION_SECRET));

/** Redis never sees the raw session id (the cookie value); it sees a keyed digest of it. */
const redisKey = (id: string): string => `sess:${lookupDigest(sessionKeys().lookup, id)}`;
const lockKey = (id: string): string => `sess-lock:${lookupDigest(sessionKeys().lookup, id)}`;

function write(id: string, session: Session, mode?: "XX"): Promise<boolean> {
  const k = redisKey(id);
  const ttl = Math.max(1_000, session.refreshExpiresAt - Date.now());
  return getStore().set(k, seal(sessionKeys().encryption, JSON.stringify(session), k), ttl, mode);
}

/** Creates a session; Redis TTL is the refresh-token lifetime. Returns the cookie value. */
export async function createSession(tokens: Tokens): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await write(id, { ...tokens, createdAt: Date.now() });
  return id;
}

async function loadSession(id: string): Promise<Session | null> {
  if (!ID_PATTERN.test(id)) return null;
  const k = redisKey(id);
  const sealed = await getStore().get(k);
  if (sealed === null) return null;
  const plain = unseal(sessionKeys().encryption, sealed, k);
  if (plain === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(plain));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The signed-in user for a session id, or null. Carries no tokens. */
export async function getSession(id: string): Promise<SessionView | null> {
  const session = await loadSession(id);
  return session
    ? {
        userSub: session.userSub,
        expiresAt: session.refreshExpiresAt,
        createdAt: session.createdAt,
      }
    : null;
}

export async function destroySession(id: string): Promise<void> {
  if (ID_PATTERN.test(id)) await getStore().del(redisKey(id));
}

/** Destroys the session and returns its ID token, used only as the IdP logout hint. */
export async function endSession(id: string): Promise<string | undefined> {
  try {
    return (await loadSession(id))?.idToken;
  } finally {
    // Always attempt the delete, even when the read failed.
    await destroySession(id);
  }
}

const isFresh = (s: Session): boolean => s.expiresAt - Date.now() > REFRESH_MARGIN_MS;

/** Runs while holding the refresh lock. Re-reads first: another request may have refreshed. */
async function refreshLocked(id: string): Promise<string | null> {
  const current = await loadSession(id);
  if (!current) return null;
  if (isFresh(current)) return current.accessToken;
  try {
    const update = await refresh(current.refreshToken);
    if (update.userSub !== undefined && update.userSub !== current.userSub) {
      throw new Error("subject changed on refresh");
    }
    const next: Session = { ...current, ...update, userSub: current.userSub };
    // XX: never resurrect a session that was destroyed (logout) while the refresh ran.
    return (await write(id, next, "XX")) ? next.accessToken : null;
  } catch (err) {
    (await requestLog()).info({ event: "auth.refresh_failed", errorName: (err as Error).name });
    await destroySession(id);
    return null;
  }
}

/**
 * The outcome of asking for an access token. `signed-out`: there is no usable session (none,
 * or the refresh failed and the session was destroyed), so the user must sign in again.
 * `unavailable`: the IdP could not be reached (or the refresh lock wait ran out); the session
 * is kept, and sending the user to sign-in would only loop, so callers show an error instead.
 */
export type AccessTokenResult =
  { status: "ok"; accessToken: string } | { status: "signed-out" } | { status: "unavailable" };

const signedOut = { status: "signed-out" } as const;
const unavailable = { status: "unavailable" } as const;
const ok = (accessToken: string) => ({ status: "ok", accessToken }) as const;

/**
 * Returns a usable access token, refreshing when fewer than 30 s remain. Concurrent callers
 * for one session share a single refresh through a Redis lock (`SET NX PX`); Keycloak rotates
 * refresh tokens, so a second refresh with the old token would fail and end the session.
 */
export async function resolveAccessToken(id: string): Promise<AccessTokenResult> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const session = await loadSession(id);
    if (!session) return signedOut;
    if (isFresh(session)) return ok(session.accessToken);

    try {
      await ensureDiscovery();
    } catch (err) {
      // IdP unreachable: nothing was attempted with the refresh token, so keep the session.
      (await requestLog()).warn({
        event: "auth.refresh_unavailable",
        errorName: (err as Error).name,
      });
      return unavailable;
    }

    const lock = lockKey(id);
    const owner = randomBytes(16).toString("base64url");
    if (await getStore().set(lock, owner, LOCK_TTL_MS, "NX")) {
      try {
        const token = await refreshLocked(id);
        return token === null ? signedOut : ok(token);
      } finally {
        await getStore().delIfEquals(lock, owner);
      }
    }
    if (Date.now() >= deadline) return unavailable;
    await sleep(LOCK_POLL_MS);
  }
}

/** Like resolveAccessToken, but null for every outcome other than a token. */
export async function getAccessToken(id: string): Promise<string | null> {
  const result = await resolveAccessToken(id);
  return result.status === "ok" ? result.accessToken : null;
}
