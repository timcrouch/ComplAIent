import { existsSync } from "node:fs";

/**
 * E2E environment. The root .env (dev-only values) is loaded if present; variables already
 * set in the shell win. Ports come from the environment (E2E_API_PORT, else API_PORT; and
 * KEYCLOAK_PORT) with the .env.example defaults, and are passed to the servers on the
 * command line.
 */
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const WEB_URL = "http://localhost:3000";
export const API_PORT = process.env.E2E_API_PORT ?? process.env.API_PORT ?? "4000";
export const API_URL = `http://localhost:${API_PORT}`;
/**
 * A second API on the same test database with demo mode off (spec §6): the demo spec checks
 * that the demo routes do not exist there. The main API above runs with demo mode on.
 */
export const DEMO_OFF_API_PORT = process.env.E2E_DEMO_OFF_API_PORT ?? "4001";
export const DEMO_OFF_API_URL = `http://localhost:${DEMO_OFF_API_PORT}`;
/**
 * The e2e evidence bucket, never the dev one (`isms-evidence`): the demo spec's reset deletes
 * every object under evidence/ in the bucket it is given. The setup project creates it.
 */
export const E2E_S3_BUCKET = "isms-evidence-test";
export const S3_ENDPOINT = `http://localhost:${process.env.MINIO_PORT ?? "9000"}`;
export const KEYCLOAK_URL = `http://localhost:${process.env.KEYCLOAK_PORT ?? "8080"}`;
export const OIDC_ISSUER_URL = `${KEYCLOAK_URL}/realms/isms`;
export const AUTHORIZE_URL = `${OIDC_ISSUER_URL}/protocol/openid-connect/auth`;
/**
 * e2e's own Redis database (index 1 by default, E2E_REDIS_DB to change it) on the local Redis
 * from REDIS_URL, so the login spec's session wipe and the demo spec's reset (every `sess:*`
 * key, every job queue) never touch the dev database (index 0). Every e2e server (both APIs,
 * the worker, the web app's session store) and every helper here uses this one URL.
 */
export const REDIS_URL = e2eRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379");

function e2eRedisUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${process.env.E2E_REDIS_DB ?? "1"}`;
  return url.toString();
}
/** Signs in on first login as organisation administrator if no administrator exists yet. */
export const ADMIN_EMAIL = "admin@example.test";
export const REPORTER_EMAIL = "reporter@example.test";
/** Carl Ciso: signs in during setup, so the people step can give him a role. */
export const CISO_EMAIL = "ciso@example.test";
/** Olga Owner: seeded without roles; the review spec gives her a site-scoped risk owner role. */
export const OWNER_EMAIL = "owner@example.test";
/** Adam Approver: seeded without roles; the approval spec gives him the approver role. */
export const APPROVER_EMAIL = "approver@example.test";
/** Seeded without roles; e2e helpers give roles through the API as later tests need them. */
export const AUDITOR_EMAIL = "auditor@example.test";
/** Seeded without an email address, so the API rejects its tokens. */
export const NO_EMAIL_USERNAME = "noemail@example.test";

export function devUserPassword(): string {
  const value = process.env.DEV_USER_PASSWORD;
  if (!value) throw new Error("DEV_USER_PASSWORD is not set (root .env)");
  return value;
}

export const THEME_COOKIE = "isms_theme";
export const ADMIN_STATE = new URL(".auth/admin.json", import.meta.url).pathname;
export const REPORTER_STATE = new URL(".auth/reporter.json", import.meta.url).pathname;
export const CISO_STATE = new URL(".auth/ciso.json", import.meta.url).pathname;
