import "server-only";
import * as client from "openid-client";
import { env } from "./env";
import { appUrl, isLocalHttp } from "./web-url";

const SCOPE = "openid profile email";
/** Used when the token response carries no `refresh_expires_in` (Keycloak normally does). */
const DEFAULT_REFRESH_TTL_S = 30 * 60;
const DEFAULT_ACCESS_TTL_S = 5 * 60;
/** Per-request timeout for IdP calls (seconds); kept below the refresh lock TTL. */
const IDP_TIMEOUT_S = 5;

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Epoch milliseconds. */
  refreshExpiresAt: number;
  userSub: string;
};

/** A refresh response; the IdP may or may not rotate the refresh and ID tokens. */
export type RefreshedTokens = Pick<Tokens, "accessToken" | "expiresAt" | "refreshExpiresAt"> &
  Partial<Pick<Tokens, "refreshToken" | "idToken" | "userSub">>;

export type LoginState = {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  maxAge?: number;
};

let configuration: Promise<client.Configuration> | undefined;

/** Discovery is cached for the process; a failed discovery is retried on the next call. */
function oidc(): Promise<client.Configuration> {
  if (!configuration) {
    const e = env();
    const issuer = new URL(e.OIDC_ISSUER_URL);
    configuration = client
      .discovery(issuer, e.OIDC_CLIENT_ID, e.OIDC_CLIENT_SECRET, undefined, {
        timeout: IDP_TIMEOUT_S,
        // Plain http is allowed only for a local development IdP.
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- local dev IdP only
        ...(isLocalHttp(issuer) ? { execute: [client.allowInsecureRequests] } : {}),
      })
      .catch((err: unknown) => {
        configuration = undefined;
        throw err;
      });
  }
  return configuration;
}

const redirectUri = (): string => appUrl("/auth/callback", env().WEB_BASE_URL).toString();

/**
 * Completes discovery (cached). Callers that hold a time-limited lock around an IdP call
 * await this first, so a slow discovery cannot eat into the lock's TTL.
 */
export async function ensureDiscovery(): Promise<void> {
  await oidc();
}

function lifetimes(res: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers) {
  const now = Date.now();
  const refreshTtl = res.refresh_expires_in;
  return {
    expiresAt: now + (res.expiresIn() ?? DEFAULT_ACCESS_TTL_S) * 1000,
    refreshExpiresAt:
      now +
      (typeof refreshTtl === "number" && refreshTtl > 0 ? refreshTtl : DEFAULT_REFRESH_TTL_S) *
        1000,
  };
}

/**
 * Authorization code + PKCE (S256) request. `maxAge` forces re-authentication (step-up).
 * Returns the URL plus the login state the caller must store until the callback.
 */
export async function buildAuthorizationUrl(
  returnTo: string,
  options: { maxAge?: number } = {},
): Promise<LoginState & { url: URL }> {
  const config = await oidc();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const params: Record<string, string> = {
    redirect_uri: redirectUri(),
    scope: SCOPE,
    response_type: "code",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  };
  const login: LoginState = { state, codeVerifier, nonce, returnTo };
  if (options.maxAge !== undefined) {
    params.max_age = String(options.maxAge);
    login.maxAge = options.maxAge;
  }
  return { url: client.buildAuthorizationUrl(config, params), ...login };
}

/**
 * Validates the authorization response (state, iss) and exchanges the code; openid-client
 * checks the ID token's nonce, iss, aud and expiry. The URL is rebuilt from WEB_BASE_URL so
 * the redirect_uri never depends on the incoming Host header.
 */
export async function handleCallback(params: URLSearchParams, stored: LoginState): Promise<Tokens> {
  const config = await oidc();
  const currentUrl = new URL(redirectUri());
  currentUrl.search = params.toString();
  const res = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: stored.codeVerifier,
    expectedState: stored.state,
    expectedNonce: stored.nonce,
    ...(stored.maxAge !== undefined ? { maxAge: stored.maxAge } : {}),
  });
  const sub = res.claims()?.sub;
  if (!res.refresh_token || !res.id_token || !sub) {
    throw new Error("Token response lacks a refresh token, ID token or subject");
  }
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    idToken: res.id_token,
    userSub: sub,
    ...lifetimes(res),
  };
}

export async function refresh(refreshToken: string): Promise<RefreshedTokens> {
  const res = await client.refreshTokenGrant(await oidc(), refreshToken);
  const sub = res.claims()?.sub;
  return {
    accessToken: res.access_token,
    ...lifetimes(res),
    ...(res.refresh_token ? { refreshToken: res.refresh_token } : {}),
    ...(res.id_token ? { idToken: res.id_token } : {}),
    ...(sub ? { userSub: sub } : {}),
  };
}

/** RP-initiated logout. Without an ID token, `client_id` lets the IdP identify the client. */
export async function endSessionUrl(idToken: string | undefined): Promise<URL> {
  const e = env();
  return client.buildEndSessionUrl(await oidc(), {
    client_id: e.OIDC_CLIENT_ID,
    post_logout_redirect_uri: appUrl("/", e.WEB_BASE_URL).toString(),
    ...(idToken ? { id_token_hint: idToken } : {}),
  });
}
