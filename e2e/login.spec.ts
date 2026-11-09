import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  AUTHORIZE_URL,
  KEYCLOAK_URL,
  NO_EMAIL_USERNAME,
  OWNER_EMAIL,
  REPORTER_EMAIL,
  WEB_URL,
} from "./env";
import {
  countAuthorizeNavigations,
  deleteAllSessions,
  greeting,
  submitKeycloakForm,
  waitForShell,
} from "./support";

/**
 * The redirect body must not contain the shell or any user data. (Every page carries the
 * message catalogue for client components, so copy such as "Good morning" can appear.)
 */
function expectNoAppContent(html: string): void {
  expect(html).not.toContain('aria-label="Primary"');
  expect(html).not.toContain('id="main"');
  expect(html).not.toContain("@example.test");
}

async function requirePasswordUpdate(username: string): Promise<() => Promise<void>> {
  const adminUsername = process.env.KEYCLOAK_ADMIN_USER;
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!adminUsername || !adminPassword) throw new Error("Keycloak admin credentials are not set");
  const tokenResponse = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: adminUsername,
      password: adminPassword,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Keycloak admin login failed: ${String(tokenResponse.status)}`);
  }
  const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${KEYCLOAK_URL}/admin/realms/isms${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Keycloak ${init?.method ?? "GET"} ${path}: ${String(response.status)}`);
    }
    return response;
  };
  const users = (await (
    await request(`/users?username=${encodeURIComponent(username)}&exact=true`)
  ).json()) as { id: string; requiredActions?: string[] }[];
  const user = users[0];
  if (!user) throw new Error(`Keycloak user ${username} was not found`);
  const previous = user.requiredActions ?? [];
  const update = (requiredActions: string[]) =>
    request(`/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ requiredActions }),
    }).then(() => undefined);
  await update(["UPDATE_PASSWORD"]);
  return () => update(previous);
}

// Runs in Chromium and WebKit, each with a fresh browser context (no stored session).

test("Keycloak uses the accessible ComplAIent theme in light and dark", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#kc-header-wrapper")).toContainText("ComplAIent");
  await expect(page.locator('link[href*="/login/complaient/css/complaient.css"]')).toHaveCount(1);
  await expect(page.locator("#kc-form-login")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/pf-v5-theme-dark/);
  await expect(page.locator("#kc-form-login")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("invalid credentials stay on the themed sign-in screen with an error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username or email").fill(REPORTER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.locator("#kc-form-login")).toBeVisible();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page.locator('link[href*="/login/complaient/css/complaient.css"]')).toHaveCount(1);
});

test("a required password update keeps the ComplAIent theme", async ({ page }) => {
  const restore = await requirePasswordUpdate(OWNER_EMAIL);
  try {
    await page.goto("/");
    await submitKeycloakForm(page, OWNER_EMAIL);

    await expect(page.getByRole("heading", { name: "Update password" })).toBeVisible();
    await expect(page.locator("#kc-passwd-update-form")).toBeVisible();
    await expect(page.locator('link[href*="/login/complaient/css/complaient.css"]')).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await restore();
  }
});

test("unauthenticated visit redirects to Keycloak once, then back to requested page", async ({
  page,
}) => {
  const authorize = countAuthorizeNavigations(page);
  await page.goto("/");
  expect(page.url().startsWith(AUTHORIZE_URL)).toBe(true);
  await submitKeycloakForm(page, REPORTER_EMAIL);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  expect(authorize.count).toBe(1);
});

test("expired session sends user to sign-in exactly once and returns to the page", async ({
  page,
}) => {
  await page.goto("/?view=e2e");
  await submitKeycloakForm(page, REPORTER_EMAIL);
  await expect(page).toHaveURL(`${WEB_URL}/?view=e2e`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);

  // The cookie stays in the browser, but the server-side session is gone.
  await deleteAllSessions();
  const authorize = countAuthorizeNavigations(page);
  await page.reload();

  // Keycloak's own SSO session is still alive, so sign-in completes without the form.
  await expect(page).toHaveURL(`${WEB_URL}/?view=e2e`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  expect(authorize.count).toBe(1);
});

test("sign-out ends session", async ({ page }) => {
  await page.goto("/");
  await submitKeycloakForm(page, REPORTER_EMAIL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  await waitForShell(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#kc-form-login")).toBeVisible();

  // Both the app session and the IdP session are over: "/" asks for credentials again.
  await page.goto("/");
  expect(page.url().startsWith(AUTHORIZE_URL)).toBe(true);
  await expect(page.locator("#kc-form-login")).toBeVisible();
});

test("each user keeps their own theme on a shared browser (#2)", async ({ page }) => {
  const htmlTheme = () => page.locator("html").getAttribute("data-theme");
  // Picks a theme in the account menu and waits for the server action that saves it.
  const chooseTheme = async (name: "Light" | "Dark" | "System") => {
    await page.getByRole("button", { name: "Account menu" }).click();
    const group = page.getByRole("radiogroup", { name: "Theme" });
    const saved = page.waitForResponse(
      (res) => res.request().method() === "POST" && "next-action" in res.request().headers(),
    );
    await group.getByText(name, { exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(group.getByRole("radio", { name })).toBeChecked();
    await page.keyboard.press("Escape");
  };
  const signOut = async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#kc-form-login")).toBeVisible();
  };
  const signInAs = async (email: string) => {
    await page.goto("/");
    await submitKeycloakForm(page, email);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
    await waitForShell(page);
  };

  await signInAs(REPORTER_EMAIL);
  await chooseTheme("Dark");
  expect(await htmlTheme()).toBe("dark");
  await signOut();

  // The next person on this browser gets their own choice (never chosen: System).
  await signInAs(OWNER_EMAIL);
  expect(await htmlTheme()).toBeNull();
  await signOut();

  // Rita's choice was saved on her account and comes back when she signs in again.
  await signInAs(REPORTER_EMAIL);
  expect(await htmlTheme()).toBe("dark");
  await chooseTheme("System");
  expect(await htmlTheme()).toBeNull();
});

test("'Sign out' in the command palette submits the logout form", async ({ page }) => {
  await page.goto("/");
  await submitKeycloakForm(page, REPORTER_EMAIL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  await waitForShell(page);

  const logout = page.waitForRequest(
    (r) => r.url() === `${WEB_URL}/auth/logout` && r.method() === "POST",
  );
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command palette" }).fill("sign out");
  await page.keyboard.press("Enter");
  await logout;
  await expect(page.locator("#kc-form-login")).toBeVisible();
});

test("a forged session cookie never renders the app", async ({ page, context }) => {
  await context.addCookies([
    { name: "isms_session", value: "A".repeat(43), url: WEB_URL, httpOnly: true },
  ]);
  const authorize = countAuthorizeNavigations(page);
  const response = await page.request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/auth\/login\?returnTo=%2F$/);
  expectNoAppContent(await response.text());

  await page.goto("/");
  await expect(page.locator("#kc-form-login")).toBeVisible();
  expect(authorize.count).toBe(1);
});

test("a dotted path (skipped by the proxy) still requires sign-in", async ({ page, context }) => {
  for (const cookie of [[], [{ name: "isms_session", value: "B".repeat(43), url: WEB_URL }]]) {
    await context.clearCookies();
    await context.addCookies(cookie);
    const response = await page.request.get("/x/v1.2", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/auth\/login\?returnTo=/);
    expectNoAppContent(await response.text());
  }

  await page.goto("/x/v1.2");
  await expect(page.locator("#kc-form-login")).toBeVisible();
});

test("an ended session is caught on client-side navigation too (pages re-check)", async ({
  page,
}) => {
  await page.goto("/?view=e2e");
  await submitKeycloakForm(page, REPORTER_EMAIL);
  await expect(page).toHaveURL(`${WEB_URL}/?view=e2e`);
  await waitForShell(page);

  // The (app) layout is not re-rendered on client navigation; only the page is.
  await deleteAllSessions();
  const authorize = countAuthorizeNavigations(page);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home" })
    .click();

  await expect(page).toHaveURL(`${WEB_URL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
  expect(authorize.count).toBe(1);
});

test("missing static assets are a plain 404 without the app; the icon is served", async ({
  page,
}) => {
  for (const path of ["/favicon.ico", "/missing.png", "/deep/path/app.js"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).toBe("Not found");
  }
  const icon = await page.request.get("/icon.svg", { maxRedirects: 0 });
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
});

test("an account the API rejects gets a terminal screen, not a sign-in loop", async ({ page }) => {
  // The IdP signs this user in (and would again, silently), but the token has no email claim.
  const authorize = countAuthorizeNavigations(page);
  await page.goto("/");
  await submitKeycloakForm(page, NO_EMAIL_USERNAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This account can't be used here",
  );
  await page.waitForLoadState("networkidle");
  expect(authorize.count).toBe(1);
  expect(new URL(page.url()).origin).toBe(WEB_URL);
});

test("every response forbids framing", async ({ request }) => {
  for (const path of ["/auth/login?error=signin", "/icon.svg"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  }
});
