import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { anEvidenceFile, riskCount } from "./db";
import { ADMIN_EMAIL, CISO_EMAIL, DEMO_OFF_API_URL, OWNER_EMAIL, WEB_URL } from "./env";
import {
  api,
  apiToken,
  countAuthorizeNavigations,
  grantRoleViaApi,
  signIn,
  waitForShell,
} from "./support";

// The last project (spec §5, §6): Anna Admin loads the sample year from Setup, everyone is
// signed out, the sample is explored as Anna and as Olga Owner (scoped to Munich), then Anna
// resets everything. It wipes isms_test, the e2e evidence bucket, every session and the job
// queues, so it runs after every other project; the next run's setup project starts afresh.
// Serial, no retries: each step builds on the one before.
test.describe.configure({ mode: "serial", retries: 0 });

const SAMPLE_ORG = "Isarwerk Finanz AG (sample)";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

/** The typed confirmation the API expects now: the organisation name, else RESET (R5). */
async function expectedConfirmation(): Promise<string> {
  const token = await apiToken(ADMIN_EMAIL);
  const { data } = await api(token, "GET", "/api/v1/demo");
  const status = data as { enabled: boolean; organisationName: string | null };
  expect(status.enabled).toBe(true);
  return status.organisationName ?? "RESET";
}

/** Setup's "Demo and training" section, below whichever step Setup opens on. */
async function openDemoTools(page: Page): Promise<Locator> {
  await page.goto("/setup");
  // /setup redirects to a step; the step streams in after the layout (setup/loading.tsx).
  await expect(page).toHaveURL(/\/setup\/[a-z-]+$/);
  await waitForShell(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const section = page.getByRole("region", { name: "Demo and training" });
  await expect(section).toBeVisible();
  await expect(section.getByText("Demo mode is on")).toBeVisible();
  return section;
}

/**
 * Opens the dialog for `button`, checks the confirm button stays disabled for near misses
 * (Review Focus 4: other case; the trim applies to the ends only), types `expected` with
 * surrounding spaces and confirms. Everyone is signed out: the app clears the session cookie and
 * goes to "/", which sends the browser to sign-in once. Keycloak's own session is still alive
 * (as in login.spec), so that sign-in completes without the form: a new app session.
 */
async function confirmDemoAction(
  page: Page,
  section: Locator,
  action: { button: string; title: string; confirm: string },
  expected: string,
): Promise<void> {
  await section.getByRole("button", { name: action.button }).click();
  const dialog = page.getByRole("dialog", { name: action.title });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox");
  const confirm = dialog.getByRole("button", { name: action.confirm });
  await expect(confirm).toBeDisabled();
  await input.fill(expected.toLowerCase());
  await expect(confirm).toBeDisabled();
  await input.fill(`${expected}x`);
  await expect(confirm).toBeDisabled();
  await input.fill(`  ${expected} `);
  await expect(confirm).toBeEnabled();
  const before = await sessionCookie(page);
  const authorize = countAuthorizeNavigations(page);
  await confirm.click();
  // The load resets and writes a year of rows (spec: under 30 s), then signs everyone out.
  await expect.poll(() => authorize.count, { timeout: 60_000 }).toBe(1);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await waitForShell(page);
  expect(await sessionCookie(page)).not.toBe(before);
}

async function sessionCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies(WEB_URL);
  return cookies.find((c) => c.name === "isms_session")?.value;
}

/** Every risk in the register's "All" list, after pressing "Load more" until it is gone. */
async function registerCount(page: Page): Promise<number> {
  await page.goto("/risks");
  await waitForShell(page);
  const list = page.getByRole("list", { name: "Risks" });
  const more = page.getByRole("button", { name: "Load more" });
  for (let i = 0; i < 20 && (await more.isVisible()); i++) {
    const before = await list.locator("> li").count();
    await more.click();
    await expect.poll(() => list.locator("> li").count()).toBeGreaterThan(before);
  }
  await expect(more).toBeHidden();
  return list.locator("> li").count();
}

/** Both risk maps (now and expected) place at least one risk in a cell. */
async function expectMapsShowRisks(page: Page): Promise<void> {
  for (const basis of ["inherent", "expected"] as const) {
    await page.goto(`/risks?view=map&basis=${basis}`);
    await waitForShell(page);
    const map = page.getByRole("region", { name: "Risk map" });
    await expect(map).toBeVisible();
    await expect(
      map.getByRole("link", { name: /^(Above|Within) appetite: \d+ risks?, / }).first(),
    ).toBeVisible();
  }
}

async function rolesOf(email: string): Promise<{ role: string; scope: { type: string } }[]> {
  const { data } = await api(await apiToken(email), "GET", "/api/v1/me");
  return (data as { roles: { role: string; scope: { type: string } }[] }).roles;
}

test("with demo mode off the demo routes do not exist", async () => {
  const token = await apiToken(ADMIN_EMAIL);
  // The same token on the demo-on API: the routes exist there, so the 404s below are demo mode.
  expect((await api(token, "GET", "/api/v1/demo")).status).toBe(200);
  for (const [method, path] of [
    ["GET", "/api/v1/demo"],
    ["POST", "/api/v1/demo/sample"],
    ["POST", "/api/v1/demo/reset"],
  ] as const) {
    const res = await fetch(`${DEMO_OFF_API_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      // A wrong confirmation: a 404 still proves the route is absent, and a server that has the
      // route after all answers 400 instead of wiping.
      ...(method === "POST" ? { body: JSON.stringify({ confirm: "not-a-match" }) } : {}),
    });
    expect(res.status, `${method} ${path}`).toBe(404);
  }
  // The demo-off API is a working API on the same database, not a dead port.
  expect((await fetch(`${DEMO_OFF_API_URL}/api/v1/health`)).status).toBe(200);
});

test("the API refuses a confirmation that does not match exactly", async () => {
  const expected = await expectedConfirmation();
  const token = await apiToken(ADMIN_EMAIL);
  for (const path of ["/api/v1/demo/sample", "/api/v1/demo/reset"]) {
    const { status } = await api(token, "POST", path, { confirm: expected.toLowerCase() }, [400]);
    expect(status).toBe(400);
  }
});

test("Anna loads the sample year from Setup, is signed out, and is still administrator", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const expected = await expectedConfirmation();
  // A fresh sign-in: both actions need a recent one.
  const anna = await signIn(browser, ADMIN_EMAIL, { reducedMotion: "reduce" });
  // Someone else signed in elsewhere, to show the load signs everyone out.
  const carl = await signIn(browser, CISO_EMAIL);
  const section = await openDemoTools(anna.page);
  await settleAnimations(anna.page);
  await expectNoAxeViolations(anna.page);

  await section.getByRole("button", { name: "Load sample data" }).click();
  const dialog = anna.page.getByRole("dialog", { name: "Load sample data?" });
  await expect(dialog).toBeVisible();
  // R5: the organisation name when there is one, RESET only before any organisation exists.
  await expect(
    dialog.getByRole("textbox", {
      name:
        expected === "RESET" ? "Type RESET to confirm" : "Type the organisation name to confirm",
    }),
  ).toBeVisible();
  if (expected !== "RESET")
    await expect(dialog.getByText(`Type exactly: ${expected}`)).toBeVisible();
  await settleAnimations(anna.page);
  await expectNoAxeViolations(anna.page);
  await anna.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await confirmDemoAction(
    anna.page,
    section,
    {
      button: "Load sample data",
      title: "Load sample data?",
      confirm: "Replace everything with sample data",
    },
    expected,
  );

  // Carl's session is gone too: his next page load signs him in again.
  const carlAuthorize = countAuthorizeNavigations(carl.page);
  await carl.page.reload();
  await expect(carl.page).toHaveURL(`${WEB_URL}/`);
  await waitForShell(carl.page);
  expect(carlAuthorize.count).toBe(1);
  await carl.context.close();

  // R6: Anna pressed the button, so her own sign-in owns her sample row: administrator. Her
  // new session can open Setup and its demo tools (organisation.manage).
  await openDemoTools(anna.page);
  await anna.context.close();
  const roles = await rolesOf(ADMIN_EMAIL);
  expect(roles).toContainEqual(
    expect.objectContaining({
      role: "administrator",
      scope: expect.objectContaining({ type: "organisation" }),
    }),
  );
  expect(await expectedConfirmation()).toBe(SAMPLE_ORG);
});

test("the sample year fills the register, the board pack and evidence", async ({ browser }) => {
  test.setTimeout(120_000);
  // Carl Ciso, organisation-wide: the administrator role has no risks.read or reports.read.
  const carl = await signIn(browser, CISO_EMAIL);
  const total = await riskCount();
  expect(total).toBeGreaterThanOrEqual(100);
  expect(total).toBeLessThanOrEqual(140);
  expect(await registerCount(carl.page)).toBe(total);

  // The board pack for last month (UTC, as the period keys are).
  await carl.page.goto("/reports/board");
  await waitForShell(carl.page);
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastKey = `${String(last.getUTCFullYear())}-${String(last.getUTCMonth() + 1).padStart(2, "0")}`;
  const periods = carl.page.getByRole("navigation", { name: "Period" });
  await periods.getByRole("link", { name: lastKey, exact: true }).click();
  await expect(carl.page).toHaveURL(new RegExp(`period=${lastKey}`));
  await waitForShell(carl.page);
  await expect(
    carl.page.getByRole("region", { name: "The headline numbers" }).getByRole("listitem"),
  ).toHaveCount(7);
  await expect(
    carl.page.getByRole("img", { name: /^Weekly movement over 12 weeks: / }),
  ).toBeVisible();
  const owners = carl.page.getByRole("table", { name: "Risks by owner, most open risks first" });
  await expect(owners).toBeVisible();
  expect(await owners.locator("tbody tr").count()).toBeGreaterThanOrEqual(10);

  // A sample evidence file downloads, and its bytes are the ones recorded.
  const file = await anEvidenceFile();
  await carl.page.goto(`/risks/${file.riskId}`);
  await waitForShell(carl.page);
  const item = carl.page
    .getByRole("region", { name: "Evidence" })
    .getByRole("list", { name: "Evidence files" })
    .locator("> li")
    .filter({ hasText: file.sha256 });
  await expect(item).toHaveCount(1);
  const [download] = await Promise.all([
    carl.page.waitForEvent("download"),
    item.getByRole("link", { name: `Download ${file.fileName}` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(file.fileName);
  expect(await download.failure()).toBeNull();
  const body = await readFile(await download.path());
  expect(body.byteLength).toBeGreaterThan(0);
  expect(createHash("sha256").update(body).digest("hex")).toBe(file.sha256);

  await expectMapsShowRisks(carl.page);
  await carl.context.close();
});

test("Olga Owner claims her sample place and sees a smaller picture", async ({ browser }) => {
  test.setTimeout(120_000);
  // Her first sign-in after the load claims the placeholder the sample made for her (R6).
  const olga = await signIn(browser, OWNER_EMAIL);
  const roles = await rolesOf(OWNER_EMAIL);
  expect(roles).toContainEqual(
    expect.objectContaining({
      role: "risk_owner",
      scope: expect.objectContaining({ type: "site" }),
    }),
  );
  // R9: scoped to Munich, so fewer risks than Carl sees organisation-wide (all of them, as
  // checked above); the maps show some. Her role has no reports.read, so no board pack.
  const seen = await registerCount(olga.page);
  expect(seen).toBeGreaterThan(0);
  expect(seen).toBeLessThan(await riskCount());
  await expectMapsShowRisks(olga.page);
  await olga.context.close();
});

test("Anna resets everything and Setup starts again at its first step", async ({ browser }) => {
  test.setTimeout(120_000);
  const expected = await expectedConfirmation();
  expect(expected).toBe(SAMPLE_ORG);
  const anna = await signIn(browser, ADMIN_EMAIL);
  const section = await openDemoTools(anna.page);
  await confirmDemoAction(
    anna.page,
    section,
    { button: "Reset everything", title: "Reset everything?", confirm: "Delete everything" },
    expected,
  );

  // A fresh install: the bootstrap grant makes Anna administrator again (BOOTSTRAP_ADMIN_EMAIL).
  await anna.page.getByRole("link", { name: "Set up your organisation" }).click();
  await expect(anna.page).toHaveURL(`${WEB_URL}/setup/organisation`);
  await anna.page.goto("/setup");
  await expect(anna.page).toHaveURL(`${WEB_URL}/setup/organisation`);
  await anna.context.close();
  expect(await expectedConfirmation()).toBe("RESET");

  // The register is empty. The administrator cannot read risks, and after the reset nobody
  // else has a role, so Anna gives Carl the security lead role again to look.
  expect(await riskCount()).toBe(0);
  await grantRoleViaApi(CISO_EMAIL, "ciso");
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/risks");
  await waitForShell(carl.page);
  await expect(carl.page.getByText("No risks to show here.")).toBeVisible();
  await carl.context.close();
});
