import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { auditActions } from "./db";
import { ADMIN_EMAIL, ADMIN_STATE, AUDITOR_EMAIL, CISO_STATE, THEME_COOKIE, WEB_URL } from "./env";
import {
  api,
  apiToken,
  grantRoleViaApi,
  signIn,
  turnAiOffViaApi,
  turnAiOnViaApi,
  waitForShell,
} from "./support";

// Runs after library on the organisation org-setup created. The API runs AI_PROVIDER=mock with
// a test AI_SECRETS_KEY (playwright.config.ts), so no request leaves the machine. Serial: the
// first test saves the key the others build on.
test.describe.configure({ mode: "serial", retries: 0 });

const KEY = "sk-or-v1-e2e-1111111111111111-WXYZ";
const REPLACEMENT = "sk-or-v1-e2e-2222222222222222-WXYZ";
const KEY_STATUS = /^A key is set · ends in WXYZ · set by Anna Admin on \d{1,2} [A-Z][a-z]+ \d{4}$/;

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(results.violations).toEqual([]);
}

/** Waits for the entrance fades: axe would measure contrast mid-fade otherwise. */
async function settle(page: Page): Promise<void> {
  await waitForShell(page);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

const summary = (page: Page) => page.getByRole("region", { name: "Status" });

test("admin saves a key, sees only its last 4, chooses models, tests the connection and turns AI on", async ({
  browser,
}) => {
  // A fresh sign-in: every settings write needs a recent sign-in (step-up, as in org-setup).
  const { context, page } = await signIn(browser, ADMIN_EMAIL);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/settings/ai`);
  await expect(page).toHaveTitle("AI assistant · Settings · ComplAIent ISMS");
  await expect(
    summary(page).getByText("The AI assistant can't run: no key is saved."),
  ).toBeVisible();

  const input = page.getByLabel("OpenRouter key");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await input.fill(KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(KEY_STATUS)).toBeVisible();
  await expect(page.getByLabel("OpenRouter key")).toHaveCount(0);
  await expect(page.getByText(KEY)).toHaveCount(0);

  // Privacy: switching one off pauses AI; both are back on before choosing models.
  const eu = page.getByRole("switch", { name: "EU-only routing" });
  await expect(eu).toBeChecked();
  await eu.click();
  await expect(page.getByText("AI is paused until both are on.")).toBeVisible();
  await expect(
    page.getByText("Models can be chosen once both privacy switches are on."),
  ).toBeVisible();
  await eu.click();
  await expect(page.getByText("AI is paused until both are on.")).toHaveCount(0);

  for (const purpose of ["Conversation", "Control suggestions", "Framework suggestions"]) {
    await page.getByRole("combobox", { name: purpose }).selectOption({ label: "Test model" });
  }
  await page.getByRole("button", { name: "Save models" }).click();
  await expect(page.getByText("Models saved.")).toBeVisible();

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Connected. mock/isms-test answered the test request." }),
  ).toBeVisible();

  await page.getByRole("switch", { name: "AI assistant on/off" }).click();
  await expect(summary(page).getByText("The AI assistant is on and ready.")).toBeVisible();
  for (const ready of [
    "Conversation ready",
    "Control suggestions ready",
    "Framework suggestions ready",
  ]) {
    await expect(summary(page).getByText(ready)).toBeVisible();
  }

  // Stored: still there after a reload.
  await page.reload();
  await expect(page.getByText(KEY_STATUS)).toBeVisible();
  await expect(page.getByRole("switch", { name: "AI assistant on/off" })).toBeChecked();

  expect(await auditActions()).toEqual(
    expect.arrayContaining(["ai.key_set", "ai.settings_changed", "ai.connection_tested"]),
  );
  await context.close();
});

test("the key never appears in any API response the page receives", async ({ browser }) => {
  const { context, page } = await signIn(browser, ADMIN_EMAIL);
  const bodies: string[] = [];
  // The server action's own response (a POST to the page URL) must be among those read.
  const postBodies: string[] = [];
  // Every /settings response is read on its way to the page, not from the browser afterwards:
  // the browser need not keep a body (the client stops reading a server action's stream once it
  // has the result, net::ERR_ABORTED), and with a route installed, reading an aborted
  // prefetch's body from the browser never settles.
  await page.route(
    (url) => url.pathname.startsWith("/settings"),
    async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      bodies.push(text);
      if (route.request().method() === "POST") postBodies.push(text);
      // The page may have dropped the request meanwhile (an aborted prefetch); nothing to answer.
      await route.fulfill({ response, body: text }).catch(() => undefined);
    },
  );
  await page.goto("/settings/ai");
  await waitForShell(page);
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByLabel("OpenRouter key").fill(REPLACEMENT);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(KEY_STATUS)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Key saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByText(KEY_STATUS)).toBeVisible();
  // Lets every handler in flight finish reading its body before the checks.
  await page.unrouteAll({ behavior: "wait" });
  expect(bodies.length).toBeGreaterThan(1);
  expect(postBodies.length).toBeGreaterThan(0);
  expect(bodies.join("\n")).not.toContain("sk-or-v1-e2e");
  expect(await auditActions()).toContain("ai.key_replaced");
  await context.close();
});

test("a ciso has no Settings entry and /settings/ai shows the no-access screen", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: CISO_STATE });
  const page = await context.newPage();
  await page.goto("/");
  await waitForShell(page);
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" }),
  ).toHaveCount(0);
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This part of the workspace isn't open to you",
  );
  await expect(page.getByLabel("OpenRouter key")).toHaveCount(0);
  await context.close();
});

test("the API helpers for later tests switch AI off and on and grant roles", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await turnAiOffViaApi();
  await page.goto("/settings/ai");
  await expect(summary(page).getByText("The AI assistant is off.")).toBeVisible();
  await turnAiOnViaApi();
  await page.reload();
  await expect(summary(page).getByText("The AI assistant is on and ready.")).toBeVisible();

  await grantRoleViaApi(AUDITOR_EMAIL, "auditor");
  await grantRoleViaApi(AUDITOR_EMAIL, "auditor");
  const data = (await api(await apiToken(ADMIN_EMAIL), "GET", "/api/v1/users")).data as {
    users: { email: string; roles: { role: string }[] }[];
  };
  const auditor = data.users.find((u) => u.email === AUDITOR_EMAIL);
  expect(auditor?.roles.map((r) => r.role)).toEqual(["auditor"]);
  await context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`settings page passes axe in ${theme}`, async ({ browser }) => {
    // Reduced motion pins the entrance to its end state, so axe never sees a half-faded page.
    const context = await browser.newContext({
      storageState: ADMIN_STATE,
      reducedMotion: "reduce",
    });
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    const page = await context.newPage();
    await page.goto("/settings/ai");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await settle(page);
    await expectNoAxeViolations(page);

    // The key form while replacing, and the remove confirmation.
    await page.getByRole("button", { name: "Replace" }).click();
    await expect(page.getByLabel("OpenRouter key")).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Keep key" }).click();
    await context.close();
  });
}
