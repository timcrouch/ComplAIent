import { isLocalHttp, webBaseUrl } from "./web-url";

export { webBaseUrl } from "./web-url";

export type CookieSettings = {
  name: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/" };
};

/**
 * Cookies are `Secure` unless the app runs on plain http://localhost or http://127.0.0.1
 * (local development). Secure cookies take the `__Host-` prefix, which browsers accept only
 * with Secure, Path=/ and no Domain, so a sibling subdomain cannot plant or overwrite them.
 */
export function cookieSettings(webBaseUrl: string, baseName: string): CookieSettings {
  const secure = !isLocalHttp(new URL(webBaseUrl));
  return {
    name: secure ? `__Host-${baseName}` : baseName,
    options: { httpOnly: true, secure, sameSite: "lax", path: "/" },
  };
}

export const sessionCookieSettings = (webBaseUrl: string): CookieSettings =>
  cookieSettings(webBaseUrl, "isms_session");

export const sessionCookie = (): CookieSettings => sessionCookieSettings(webBaseUrl());

/** Short-lived cookie binding a login attempt (its `state`) to the browser that started it. */
export const loginCookie = (): CookieSettings => cookieSettings(webBaseUrl(), "isms_login");
