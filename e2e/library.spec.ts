import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { loadLibrary } from "@isms/control-library";
import { expect, test, type Page } from "@playwright/test";
import { auditActions } from "./db";
import { ADMIN_STATE, CISO_STATE, REPORTER_STATE, THEME_COOKIE, WEB_URL } from "./env";
import { waitForShell } from "./support";

// Runs after org-setup, which gave Carl Ciso the security lead (ciso) role. The shipped
// library was loaded into isms_test by auth.setup.ts, with every mapping unreviewed.
test.describe.configure({ mode: "serial", retries: 0 });
test.use({ storageState: CISO_STATE });

const HEADER =
  "Control code,Control,Category,Framework,Framework version,Requirement," +
  "What the requirement asks for,Review status,Reviewed by,Reviewed at (UTC)";
const EMPTY = /^No controls match your search\./;

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

test("a CISO finds a control by reference and marks a mapping reviewed", async ({ page }) => {
  await page.goto("/");
  await waitForShell(page);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Controls" })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/library`);
  await expect(page).toHaveTitle("Controls · ComplAIent ISMS");

  const search = page.getByRole("search", { name: "Search controls" });
  await search.getByLabel("Search controls").fill("A.8.13");
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/library\?q=A\.8\.13/);
  await expect(
    page.getByRole("status").filter({ hasText: /^\d+ of \d+ controls?$/ }),
  ).toBeVisible();
  const cards = page.getByRole("main").getByRole("heading", { level: 2 }).getByRole("link");
  await expect(cards.first()).toBeVisible();

  await cards.first().click();
  await expect(page).toHaveURL(/\/library\/[A-Z]{3}-\d{2}$/);
  await expect(page).toHaveTitle(/ · Controls · ComplAIent ISMS$/);
  // Pin the row by its own text: once marked, it no longer holds the button.
  const firstUnreviewed = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Mark as reviewed" }) })
    .first();
  const requirement = (await firstUnreviewed.locator("div").first().textContent()) ?? "";
  expect(requirement).not.toBe("");
  const row = page.getByRole("listitem").filter({ hasText: requirement });
  await expect(row.getByText("Not yet reviewed")).toBeVisible();
  await row.getByRole("button", { name: "Mark as reviewed" }).click();
  const reviewed = /^Reviewed by Carl Ciso on \d{1,2} [A-Z][a-z]+ \d{4}$/;
  // Shown as a badge, and announced through the row's status region.
  await expect(row.getByText(reviewed).first()).toBeVisible();
  await expect(row.getByRole("status")).toHaveText(reviewed);
  await expect(row.getByRole("button", { name: "Mark as reviewed" })).toHaveCount(0);
  expect(await auditActions()).toContain("library.mapping_reviewed");

  // The review is stored: it is still there after a reload.
  await page.reload();
  await expect(page.getByText(/^Reviewed by Carl Ciso on /).first()).toBeVisible();
});

// Counts come from the shipped library itself, the one auth.setup.ts loaded into isms_test.
const LIBRARY = loadLibrary().controls;
const mapsTo = (framework: string) =>
  LIBRARY.filter((c) => c.mappings.some((m) => m.framework === framework));
const ALL = LIBRARY.length;
const ISO = mapsTo("iso27001-2022").length;
const NIST = mapsTo("nist-csf-2.0").length;

function libraryView(page: Page) {
  const main = page.getByRole("main");
  return {
    count: main.getByRole("status").filter({ hasText: /controls?$/ }),
    card: (code: string) => main.getByRole("link", { name: new RegExp(`^${code} `) }),
    framework: main.getByLabel("Framework", { exact: true }),
    category: main.getByLabel("Category", { exact: true }),
    searchBox: main.getByRole("searchbox", { name: "Search controls" }),
    chips: main.getByRole("list", { name: "Active filters" }),
    clear: main.getByRole("link", { name: "Clear filters" }),
  };
}

test("a filter narrows the list as soon as it changes, with no need to press Search", async ({
  page,
}) => {
  const view = libraryView(page);
  await page.goto("/library");
  await waitForShell(page);
  await expect(view.count).toHaveText(`${String(ALL)} controls`);
  expect(NIST).toBeLessThan(ALL);

  // selectOption fires change without focusing: focus first, as a keyboard user would be.
  await view.framework.focus();
  await view.framework.selectOption("iso27001-2022");
  await expect(page).toHaveURL(`${WEB_URL}/library?framework=iso27001-2022`);
  await expect(view.count).toHaveText(`${String(ISO)} of ${String(ALL)} controls`);
  // Focus stays on the filter that changed.
  await expect(view.framework).toBeFocused();

  await view.framework.selectOption("nist-csf-2.0");
  await expect(page).toHaveURL(`${WEB_URL}/library?framework=nist-csf-2.0`);
  await expect(view.count).toHaveText(`${String(NIST)} of ${String(ALL)} controls`);
  // GOV-12 maps to ISO 27001 only; RES-03 maps to NIST CSF 2.0 too.
  await expect(view.card("GOV-12")).toHaveCount(0);
  await expect(view.card("RES-03")).toBeVisible();
  await expect(view.chips.getByRole("link")).toHaveText(["Framework: NIST CSF 2.0"]);

  // The view is in the URL: a reload shows the same list and filter.
  await page.reload();
  await waitForShell(page);
  await expect(view.framework).toHaveValue("nist-csf-2.0");
  await expect(view.count).toHaveText(`${String(NIST)} of ${String(ALL)} controls`);

  // Back steps to the previous filter.
  await page.goBack();
  await expect(page).toHaveURL(`${WEB_URL}/library?framework=iso27001-2022`);
  await expect(view.framework).toHaveValue("iso27001-2022");
  await expect(view.count).toHaveText(`${String(ISO)} of ${String(ALL)} controls`);
});

test("search narrows within the filters, and Clear filters brings the full list back", async ({
  page,
}) => {
  const view = libraryView(page);
  await page.goto("/library?framework=nist-csf-2.0");
  await waitForShell(page);
  await expect(view.count).toHaveText(`${String(NIST)} of ${String(ALL)} controls`);

  // Typing applies after a pause, without pressing Search and without leaving the box.
  await view.searchBox.fill("backup");
  await expect(page).toHaveURL(`${WEB_URL}/library?q=backup&framework=nist-csf-2.0`);
  await expect(view.searchBox).toBeFocused();
  await expect(view.card("RES-03")).toBeVisible();
  // GOV-12 mentions backups but maps to ISO 27001 only: the filter still holds.
  await expect(view.card("GOV-12")).toHaveCount(0);
  const narrowed = Number((await view.count.textContent())?.split(" ")[0]);
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(NIST);

  // Removing the framework chip keeps the search: GOV-12 is back.
  await view.chips.getByRole("link", { name: "Remove Framework: NIST CSF 2.0" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/library?q=backup`);
  await expect(view.card("GOV-12")).toBeVisible();
  await expect(view.framework).toBeFocused();

  // A second filter on top, then Clear filters: only the search is left.
  await view.category.selectOption("resilience");
  await expect(page).toHaveURL(`${WEB_URL}/library?q=backup&category=resilience`);
  await expect(view.card("GOV-12")).toHaveCount(0);
  await view.clear.click();
  await expect(page).toHaveURL(`${WEB_URL}/library?q=backup`);
  await expect(view.chips).toHaveCount(0);

  // With the search emptied too, the whole library is back.
  await view.searchBox.fill("");
  await expect(page).toHaveURL(`${WEB_URL}/library`);
  await expect(view.count).toHaveText(`${String(ALL)} controls`);
});

test("Clear filters brings back the full list", async ({ page }) => {
  const view = libraryView(page);
  await page.goto("/library?framework=nist-csf-2.0&category=resilience&review=unreviewed");
  await waitForShell(page);
  await expect(view.chips.getByRole("link")).toHaveCount(3);
  await view.clear.click();
  await expect(page).toHaveURL(`${WEB_URL}/library`);
  await expect(view.count).toHaveText(`${String(ALL)} controls`);
  await expect(view.framework).toHaveValue("");
  await expect(view.category).toHaveValue("");
});

test("unreviewed status is visible to every library reader", async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto("/library?review=unreviewed");
  await waitForShell(page);
  await expect(page.getByText(/^\d+ of \d+ mappings reviewed$/).first()).toBeVisible();
  await page.getByRole("main").getByRole("heading", { level: 2 }).getByRole("link").first().click();
  await expect(page.getByText("Not yet reviewed").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as reviewed" })).toHaveCount(0);
  await context.close();
});

test("a Guided-view reader still sees the library, with a note about its detail", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  const note = page.getByText(/^This page shows the full detail of the Professional view\./);
  const choose = async (name: string) => {
    await page.getByRole("button", { name: "Account menu" }).click();
    const saved = page.waitForResponse(
      (res) => res.request().method() === "POST" && "next-action" in res.request().headers(),
    );
    await page
      .getByRole("radiogroup", { name: "View mode" })
      .getByText(name, { exact: true })
      .click();
    expect((await saved).ok()).toBe(true);
    await page.keyboard.press("Escape");
  };
  await page.goto("/library");
  await waitForShell(page);
  await expect(note).toHaveCount(0);
  await choose("Guided");
  await page.reload();
  await waitForShell(page);
  await expect(page.getByRole("heading", { level: 1, name: "Controls" })).toBeVisible();
  await expect(note).toBeVisible();
  // Leave the administrator as found (administrators start in Professional view).
  await choose("Professional");
  await context.close();
});

test("the export downloads a CSV with one row per mapping", async ({ page }) => {
  await page.goto("/library");
  await waitForShell(page);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^control-library(-[A-Za-z0-9._-]+)?\.csv$/);
  const text = await readFile(await file.path(), "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter(Boolean);
  expect(lines[0]).toBe(HEADER);
  // At least the 93 Annex A reference points, plus GDPR and NIS2.
  expect(lines.length - 1).toBeGreaterThan(93);
  expect(lines.some((l) => l.includes(",Reviewed,Carl Ciso,"))).toBe(true);
});

test("people without library access don't see Controls", async ({ browser }) => {
  const context = await browser.newContext({ storageState: REPORTER_STATE });
  const page = await context.newPage();
  await page.goto("/");
  await waitForShell(page);
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Controls" }),
  ).toHaveCount(0);
  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "This part of the workspace isn't open to you" }),
  ).toBeVisible();
  const res = await page.request.get("/library/export", { maxRedirects: 0 });
  expect(res.status()).toBe(403);
  await context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no violations on the library list and a control in ${theme}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: CISO_STATE, reducedMotion: "reduce" });
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    const page = await context.newPage();
    await page.goto("/library");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    // The page streams in after the shell: wait for its heading and title, not the skeleton.
    await expect(page.getByRole("heading", { level: 1, name: "Controls" })).toBeVisible();
    await expect(page).toHaveTitle("Controls · ComplAIent ISMS");
    await settle(page);
    await expectNoAxeViolations(page);
    await page
      .getByRole("main")
      .getByRole("heading", { level: 2 })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Controls");
    await expect(page).toHaveTitle(/ · Controls · ComplAIent ISMS$/);
    await settle(page);
    await expectNoAxeViolations(page);
    await page.goto("/library?q=zzzz-no-such-control");
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page).toHaveTitle("Controls · ComplAIent ISMS");
    await settle(page);
    await expectNoAxeViolations(page);
    await context.close();
  });
}
