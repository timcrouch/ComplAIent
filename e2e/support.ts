import { createHash, randomBytes } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import {
  ADMIN_EMAIL,
  API_URL,
  AUTHORIZE_URL,
  devUserPassword,
  OIDC_ISSUER_URL,
  REDIS_URL,
  WEB_URL,
} from "./env";

/** Fills the Keycloak login form; the page must already be on it. */
export async function submitKeycloakForm(page: Page, email: string): Promise<void> {
  await expect(page.locator("#kc-form-login")).toBeVisible();
  await page.fill("#username", email);
  await page.fill("#password", devUserPassword());
  await page.click("#kc-login");
}

/** Waits until the app shell has hydrated, so clicks and shortcuts are handled. */
export async function waitForShell(page: Page): Promise<void> {
  await page.locator("main[data-ready]").waitFor();
}

/** Counts top-level document navigations to the IdP authorize endpoint. */
export function countAuthorizeNavigations(page: Page): { readonly count: number } {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      request.url().startsWith(AUTHORIZE_URL)
    ) {
      counter.count += 1;
    }
  });
  return counter;
}

/** Ends every web session server-side, as if they had all expired. */
export async function deleteAllSessions(): Promise<void> {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "sess:*", "COUNT", 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
}

export const greeting = /^Good (morning|afternoon|evening), [A-Z][a-z]+\.$/;

/**
 * A fresh interactive sign-in in a new browser context, so actions that need a recent sign-in
 * (role changes, AI settings: P2-R5) are accepted for the next five minutes. Close the context.
 */
export async function signIn(
  browser: Browser,
  email: string,
  options: { reducedMotion?: "reduce" } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto("/");
  await submitKeycloakForm(page, email);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await waitForShell(page);
  return { context, page };
}

// ---------------------------------------------------------------------------------------------
// Direct API calls for arranging state (not for what a test asserts about the UI).

const b64url = (buf: Buffer): string => buf.toString("base64url");

function oidcClientSecret(): string {
  const value = process.env.OIDC_CLIENT_SECRET;
  if (!value) throw new Error("OIDC_CLIENT_SECRET is not set (root .env)");
  return value;
}

/** Cookie names and values from a response, merged into `jar`. */
function keepCookies(jar: Map<string, string>, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

/**
 * An API access token for a seeded user from a scripted authorization-code + PKCE sign-in
 * (the realm disables direct grants). Each call is a fresh sign-in, so it counts as recent.
 * Never logs the token or password.
 */
export async function apiToken(email: string): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const redirectUri = `${WEB_URL}/auth/callback`;
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: "isms-web",
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  const form = await fetch(authorize, { redirect: "manual" });
  keepCookies(jar, form);
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(await form.text())?.[1];
  if (!action) throw new Error("Keycloak login form not found");
  const submitted = await fetch(action.replaceAll("&amp;", "&"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ username: email, password: devUserPassword() }),
  });
  const location = submitted.headers.get("location");
  if (submitted.status !== 302 || !location) throw new Error(`Keycloak refused ${email}`);
  const callback = new URL(location);
  const code = callback.searchParams.get("code");
  if (callback.searchParams.get("state") !== state || !code) throw new Error("No code");

  const tokens = await fetch(`${OIDC_ISSUER_URL}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: "isms-web",
      client_secret: oidcClientSecret(),
      code_verifier: verifier,
    }),
  });
  const { access_token: token } = (await tokens.json()) as { access_token?: string };
  if (!token) throw new Error(`No access token for ${email}`);
  return token;
}

/**
 * One API call with a bearer token. Fails the test on an unexpected status (the error names
 * the route and status only, never the body, which could hold a key).
 */
export async function api(
  token: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  okStatuses: readonly number[] = [200, 201],
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!okStatuses.includes(res.status)) {
    throw new Error(`${method} ${path} returned ${String(res.status)}`);
  }
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as unknown) : undefined };
}

export type E2eRole =
  "administrator" | "ciso" | "auditor" | "risk_owner" | "risk_approver" | "contributor" | "viewer";

export type E2eScope =
  { type: "organisation"; id: null } | { type: "site" | "department"; id: string };

/**
 * Gives `email` a role, as the administrator through the API. The user is signed in once
 * first, so the API knows them. Granting a role they already hold is not an error.
 */
export async function grantRoleViaApi(
  email: string,
  role: E2eRole,
  scope: E2eScope = { type: "organisation", id: null },
): Promise<void> {
  await api(await apiToken(email), "GET", "/api/v1/me");
  const admin = await apiToken(ADMIN_EMAIL);
  const data = (await api(admin, "GET", "/api/v1/users")).data as {
    users: { id: string; email: string }[];
  };
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`${email} is not a user yet`);
  await api(admin, "POST", `/api/v1/users/${user.id}/roles`, { role, scope }, [201, 409]);
}

/** A well-formed test key for the mock provider (never a real one); its last 4 are WXYZ. */
export const E2E_AI_KEY = "sk-or-v1-e2e-0000000000000000-WXYZ";

/**
 * Turns the AI assistant on through the settings API, as the administrator: saves a key,
 * turns both privacy switches on, chooses the first offered model for every purpose and
 * switches AI on. The e2e API runs AI_PROVIDER=mock, so no request leaves the machine.
 */
export async function turnAiOnViaApi(): Promise<void> {
  const admin = await apiToken(ADMIN_EMAIL);
  await api(admin, "PUT", "/api/v1/settings/ai/key", { key: E2E_AI_KEY });
  await api(admin, "PATCH", "/api/v1/settings/ai", { euOnly: true, zeroRetention: true });
  const data = (await api(admin, "GET", "/api/v1/settings/ai/models")).data as {
    models: { id: string }[];
  };
  const model = data.models[0]?.id;
  if (!model) throw new Error("The AI provider offers no models");
  await api(admin, "PATCH", "/api/v1/settings/ai", {
    models: { conversation: model, controls: model, frameworks: model },
    enabled: true,
  });
}

/** Switches the AI assistant off through the settings API (the key and models stay). */
export async function turnAiOffViaApi(): Promise<void> {
  await api(await apiToken(ADMIN_EMAIL), "PATCH", "/api/v1/settings/ai", { enabled: false });
}
