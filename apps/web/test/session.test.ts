import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";

const store = new MemoryStore();
vi.mock("../lib/redis", () => ({ getStore: () => store }));
vi.mock("../lib/oidc", () => ({ refresh: vi.fn(), ensureDiscovery: vi.fn() }));

const { ensureDiscovery, refresh } = await import("../lib/oidc");
const {
  createSession,
  destroySession,
  endSession,
  getAccessToken,
  getSession,
  resolveAccessToken,
} = await import("../lib/session");
const { safeReturnTo } = await import("../lib/return-to");
const { sessionCookieSettings } = await import("../lib/cookie");

const refreshMock = vi.mocked(refresh);

/** The refresh token now stored, observed by forcing one more refresh 10 minutes ahead. */
async function storedRefreshToken(id: string): Promise<string | undefined> {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + 600_000);
  try {
    refreshMock.mockResolvedValueOnce({
      accessToken: "probe",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
    });
    await getAccessToken(id);
    return refreshMock.mock.calls.at(-1)?.[0];
  } finally {
    vi.mocked(Date.now).mockRestore();
  }
}

function tokens(accessTtlMs: number, refreshTtlMs = 1_800_000) {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    idToken: "id-1",
    expiresAt: Date.now() + accessTtlMs,
    refreshExpiresAt: Date.now() + refreshTtlMs,
    userSub: "user-1",
  };
}

function onlyEntry(): [string, { value: string; expiresAt: number }] {
  const entries = [...store.data.entries()];
  expect(entries).toHaveLength(1);
  return entries[0] as [string, { value: string; expiresAt: number }];
}

beforeEach(() => {
  store.data.clear();
  refreshMock.mockReset();
  vi.mocked(ensureDiscovery).mockReset();
});

describe("safeReturnTo", () => {
  it.each([
    ["/risks", "/risks"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    [null, "/"],
    ["/a?b=1", "/a?b=1"],
    ["", "/"],
    ["risks", "/"],
    ["/\\evil.com", "/"],
    ["/a\\b", "/"],
    ["/%2F%2Fevil.com", "/"],
    ["/%2f%2fevil.com", "/"],
    ["/%5Cevil.com", "/"],
    ["/%5cevil.com", "/"],
    ["/%252F%252Fevil.com", "/"],
    ["/%252f%252fevil.com", "/"],
    ["/%255Cevil.com", "/"],
    ["/%25252F%25252Fevil.com", "/"],
    ["/%2525252F%2525252Fevil.com", "/"],
    ["/search?q=100%25", "/search?q=100%25"],
    ["/%252F%252Fevil.com%25", "/"],
    ["/%25252F%25252Fevil.com%2525", "/"],
    ["/%2525252F%2525252Fevil.com%252525", "/"],
    ["/a%25b", "/a%25b"],
    [" /risks", "/"],
    ["\t/risks", "/"],
    ["/ris\nks", "/"],
    ["/risks\u0000", "/"],
    ["/risks%0d%0aSet-Cookie:x", "/"],
    ["/%E0%A4%A", "/"],
    ["/auth/login", "/"],
    ["/auth/callback?x=1", "/"],
    ["/auth", "/"],
    ["/%61uth/login", "/"],
    ["/authors", "/authors"],
    ["/risks/r%20one?tab=controls#top", "/risks/r%20one?tab=controls#top"],
    [`/${"a".repeat(2048)}`, "/"],
  ])("safeReturnTo(%j) → %j", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe("session cookie", () => {
  it("is not Secure and keeps the plain name on http://localhost", () => {
    expect(sessionCookieSettings("http://localhost:3000")).toEqual({
      name: "isms_session",
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/" },
    });
  });

  it("is Secure with the __Host- prefix on https", () => {
    expect(sessionCookieSettings("https://isms.example.com")).toEqual({
      name: "__Host-isms_session",
      options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    });
  });

  it("treats http://127.0.0.1 as local development too", () => {
    expect(sessionCookieSettings("http://127.0.0.1:3000").name).toBe("isms_session");
  });

  it("is Secure for plain http on a non-localhost host", () => {
    expect(sessionCookieSettings("http://isms.internal").options.secure).toBe(true);
  });
});

describe("sessions", () => {
  it("creates a 32-byte base64url id and round-trips the session", async () => {
    const t = tokens(300_000);
    const id = await createSession(t);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(id, "base64url")).toHaveLength(32);
    expect(await getSession(id)).toEqual({
      userSub: "user-1",
      expiresAt: t.refreshExpiresAt,
      createdAt: expect.any(Number) as number,
    });
    expect(await getAccessToken(id)).toBe("access-1");
  });

  it("records when the session was created and keeps it across a refresh", async () => {
    const before = Date.now();
    const id = await createSession(tokens(10_000));
    const createdAt = (await getSession(id))?.createdAt ?? 0;
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
    });
    expect(await getAccessToken(id)).toBe("access-2");
    expect((await getSession(id))?.createdAt).toBe(createdAt);
  });

  it("getSession exposes no tokens", async () => {
    const id = await createSession(tokens(300_000));
    const view = JSON.stringify(await getSession(id));
    for (const secret of ["access-1", "refresh-1", "id-1"]) expect(view).not.toContain(secret);
  });

  it("endSession destroys the session and returns the ID token hint", async () => {
    const id = await createSession(tokens(300_000));
    expect(await endSession(id)).toBe("id-1");
    expect(await getSession(id)).toBeNull();
    expect(await endSession(id)).toBeUndefined();
  });

  it("sets the Redis TTL to the refresh lifetime", async () => {
    const id = await createSession(tokens(300_000, 1_200_000));
    const [key] = [...store.data.keys()];
    expect(key).toMatch(/^sess:/);
    const ttl = store.ttl(key ?? "");
    expect(ttl).toBeGreaterThan(1_190_000);
    expect(ttl).toBeLessThanOrEqual(1_200_000);
    expect(await getSession(id)).not.toBeNull();
  });

  it("stores neither the session id nor any token in plaintext", async () => {
    const id = await createSession(tokens(300_000));
    const [key, entry] = onlyEntry();
    expect(key).not.toContain(id);
    for (const secret of ["access-1", "refresh-1", "id-1", "user-1"]) {
      expect(entry.value).not.toContain(secret);
    }
  });

  it("rejects a tampered ciphertext", async () => {
    const id = await createSession(tokens(300_000));
    const [key, entry] = onlyEntry();
    const [version, payload = ""] = entry.value.split(".");
    const bytes = Buffer.from(payload, "base64url");
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0x01; // flip one ciphertext bit
    store.data.set(key, { ...entry, value: `${version ?? ""}.${bytes.toString("base64url")}` });
    expect(await getSession(id)).toBeNull();
  });

  it("returns null for unknown and malformed ids", async () => {
    expect(await getSession("x".repeat(43))).toBeNull();
    expect(await getSession("not a session id")).toBeNull();
  });

  it("destroySession removes the session", async () => {
    const id = await createSession(tokens(300_000));
    await destroySession(id);
    expect(await getSession(id)).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("returns the current token without refreshing when more than 30 s remain", async () => {
    const id = await createSession(tokens(60_000));
    expect(await getAccessToken(id)).toBe("access-1");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("getAccessToken refreshes near expiry", async () => {
    const id = await createSession(tokens(10_000));
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      idToken: "id-2",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
      userSub: "user-1",
    });
    expect(await getAccessToken(id)).toBe("access-2");
    expect(refreshMock).toHaveBeenCalledWith("refresh-1");
    expect(await getAccessToken(id)).toBe("access-2");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(await storedRefreshToken(id)).toBe("refresh-2");
    expect(await endSession(id)).toBe("id-2");
  });

  it("keeps the previous refresh and ID tokens when the IdP does not rotate them", async () => {
    const id = await createSession(tokens(10_000));
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
    });
    expect(await getAccessToken(id)).toBe("access-2");
    expect(await storedRefreshToken(id)).toBe("refresh-1");
    expect(await endSession(id)).toBe("id-1");
  });

  it("getAccessToken returns null and destroys session when refresh fails", async () => {
    const id = await createSession(tokens(10_000));
    refreshMock.mockRejectedValue(new Error("invalid_grant"));
    expect(await getAccessToken(id)).toBeNull();
    expect(await getSession(id)).toBeNull();
  });

  it("destroys the session when the refreshed tokens belong to another subject", async () => {
    const id = await createSession(tokens(10_000));
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      expiresAt: Date.now() + 300_000,
      refreshExpiresAt: Date.now() + 1_800_000,
      userSub: "someone-else",
    });
    expect(await getAccessToken(id)).toBeNull();
    expect(await getSession(id)).toBeNull();
  });

  it("refreshes only once for concurrent requests on the same session", async () => {
    const id = await createSession(tokens(10_000));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    refreshMock.mockImplementation(async () => {
      await gate;
      return {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresAt: Date.now() + 300_000,
        refreshExpiresAt: Date.now() + 1_800_000,
      };
    });
    const pending = [getAccessToken(id), getAccessToken(id), getAccessToken(id)];
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    expect(await Promise.all(pending)).toEqual(["access-2", "access-2", "access-2"]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a session destroyed while a refresh was in flight", async () => {
    const id = await createSession(tokens(10_000));
    refreshMock.mockImplementation(async () => {
      await destroySession(id);
      return {
        accessToken: "access-2",
        expiresAt: Date.now() + 300_000,
        refreshExpiresAt: Date.now() + 1_800_000,
      };
    });
    expect(await getAccessToken(id)).toBeNull();
    expect(await getSession(id)).toBeNull();
  });

  it("finishes discovery before taking the lock, and keeps the session if the IdP is down", async () => {
    const id = await createSession(tokens(10_000));
    vi.mocked(ensureDiscovery).mockRejectedValue(new Error("discovery failed"));
    expect(await getAccessToken(id)).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect([...store.data.keys()].some((k) => k.startsWith("sess-lock:"))).toBe(false);
    expect(await getSession(id)).not.toBeNull();
  });

  it("returns null for an unknown session", async () => {
    expect(await getAccessToken("y".repeat(43))).toBeNull();
  });
});

describe("resolveAccessToken", () => {
  it("returns the token for a live session", async () => {
    const id = await createSession(tokens(60_000));
    expect(await resolveAccessToken(id)).toEqual({ status: "ok", accessToken: "access-1" });
  });

  it("reports signed-out for an unknown session and after a failed refresh", async () => {
    expect(await resolveAccessToken("y".repeat(43))).toEqual({ status: "signed-out" });
    const id = await createSession(tokens(10_000));
    refreshMock.mockRejectedValue(new Error("invalid_grant"));
    expect(await resolveAccessToken(id)).toEqual({ status: "signed-out" });
  });

  it("reports unavailable (and keeps the session) when the IdP cannot be reached", async () => {
    const id = await createSession(tokens(10_000));
    vi.mocked(ensureDiscovery).mockRejectedValue(new Error("discovery failed"));
    expect(await resolveAccessToken(id)).toEqual({ status: "unavailable" });
    expect(await getSession(id)).not.toBeNull();
  });
});
