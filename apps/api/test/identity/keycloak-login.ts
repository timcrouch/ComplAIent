import { createHash, randomBytes } from "node:crypto";

export type KeycloakLogin = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  username: string;
  password: string;
};

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** Minimal cookie jar: keeps the latest value of each cookie name. */
class CookieJar {
  private readonly cookies = new Map<string, string>();
  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/**
 * Test-only scripted browser login: authorization code + PKCE (S256) against the local
 * Keycloak, which disables direct grants. Returns the access token. Never logs secrets.
 */
export async function keycloakAccessToken(login: KeycloakLogin): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const jar = new CookieJar();

  const authorize = new URL(`${login.issuer}/protocol/openid-connect/auth`);
  authorize.search = new URLSearchParams({
    client_id: login.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: login.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const page = await fetch(authorize, { redirect: "manual" });
  jar.store(page);
  if (page.status !== 200) throw new Error(`authorize returned ${String(page.status)}`);
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(await page.text())?.[1];
  if (!action) throw new Error("login form not found");

  const submitted = await fetch(action.replaceAll("&amp;", "&"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ username: login.username, password: login.password }),
  });
  const location = submitted.headers.get("location");
  if (submitted.status !== 302 || !location) {
    throw new Error(`login returned ${String(submitted.status)} without a redirect`);
  }
  const callback = new URL(location);
  if (callback.searchParams.get("state") !== state) throw new Error("state mismatch");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("no authorization code in redirect");

  const tokenRes = await fetch(`${login.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: login.redirectUri,
      client_id: login.clientId,
      client_secret: login.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (tokenRes.status !== 200)
    throw new Error(`token endpoint returned ${String(tokenRes.status)}`);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) throw new Error("no access token");
  return accessToken;
}
