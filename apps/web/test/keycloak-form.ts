/** Minimal cookie jar for scripting the Keycloak login form: latest value per cookie name. */
export class CookieJar {
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
 * Test-only: plays the browser at the Keycloak login form (direct grants are disabled) and
 * returns the redirect back to the app's callback. Never logs credentials or codes.
 */
export async function submitKeycloakLogin(
  authorizeUrl: string,
  username: string,
  password: string,
  jar: CookieJar,
): Promise<string> {
  const page = await fetch(authorizeUrl, { redirect: "manual" });
  jar.store(page);
  if (page.status !== 200) throw new Error(`authorize returned ${String(page.status)}`);
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(await page.text())?.[1];
  if (!action) throw new Error("login form not found");
  const submitted = await fetch(action.replaceAll("&amp;", "&"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ username, password }),
  });
  jar.store(submitted);
  const location = submitted.headers.get("location");
  if (submitted.status !== 302 || !location) {
    throw new Error(`login returned ${String(submitted.status)} without a redirect`);
  }
  return location;
}
