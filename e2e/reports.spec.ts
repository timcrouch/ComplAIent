import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AUDITOR_EMAIL, CISO_EMAIL, WEB_URL } from "./env";
import { api, apiToken, grantRoleViaApi, signIn, turnAiOnViaApi, waitForShell } from "./support";

// Runs after loop. Carl Ciso (security lead, set by org-setup) downloads the register, decides
// one requirement of the confirmed ISO/IEC 27001 statement, drafts, edits and approves the board
// narrative with the mock AI, downloads the board PDF and sees the Executive home. The auditor
// can read everything but change nothing. Serial: the steps share the one narrative.
test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await grantRoleViaApi(AUDITOR_EMAIL, "auditor");
  // The narrative draft needs the AI on (ai-settings leaves it on; this makes the spec self-contained).
  await turnAiOnViaApi();
});

async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("the register downloads as Excel and PDF from the hub", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/reports");
  await waitForShell(carl.page);
  await expect(carl.page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  const register = carl.page.getByRole("group", { name: "Risk register" });
  const excel = register.getByRole("link", { name: /^Excel/ });
  const pdf = register.getByRole("link", { name: /^PDF/ });
  const [xlsx] = await Promise.all([carl.page.waitForEvent("download"), excel.click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^complaient-risk-register-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const { stat } = await import("node:fs/promises");
  expect((await stat(await xlsx.path())).size).toBeGreaterThan(0);
  const [doc] = await Promise.all([carl.page.waitForEvent("download"), pdf.click()]);
  expect(doc.suggestedFilename()).toMatch(/^complaient-risk-register-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect((await stat(await doc.path())).size).toBeGreaterThan(0);
  await carl.context.close();
});

test("a requirement is marked not applicable and the summary changes", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/reports/soa");
  await waitForShell(carl.page);
  const summary = carl.page.getByRole("status").filter({ hasText: /\d+ of \d+ decided/ });
  await expect(summary).toBeVisible();
  const before = (await summary.textContent()) ?? "";
  await carl.page
    .getByRole("button", { name: /^Edit applicability of / })
    .first()
    .click();
  const dialog = carl.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByText("Not applicable", { exact: true }).click();
  await dialog.getByLabel("Justification").fill("We do not run this activity in our organisation.");
  await dialog.getByRole("button", { name: "Save decision" }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).not.toHaveText(before);
  await expect(carl.page.getByText("Decided by Carl Ciso").first()).toBeVisible();
  await carl.context.close();
});

test("the ISO 27001 statement is grouped by its four Annex A themes, each collapsible", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/reports/soa?framework=iso27001-2022");
  await waitForShell(carl.page);
  // Annex A: 37 organisational, 8 people, 14 physical and 34 technological controls.
  for (const [theme, total] of [
    ["A\\.5 Organisational controls", 37],
    ["A\\.6 People controls", 8],
    ["A\\.7 Physical controls", 14],
    ["A\\.8 Technological controls", 34],
  ] as const) {
    await expect(
      carl.page.getByRole("heading", {
        level: 2,
        name: new RegExp(`^${theme} · \\d+ of ${String(total)} decided$`),
      }),
    ).toBeVisible();
  }
  // Collapsing a theme hides its requirements; opening it shows them again.
  const people = carl.page.getByRole("heading", { level: 2, name: /^A\.6 People controls/ });
  const screening = carl.page.getByRole("rowheader", { name: /^A\.6\.1(?!\d)/ });
  await expect(screening).toBeVisible();
  await people.click();
  await expect(screening).toBeHidden();
  await people.click();
  await expect(screening).toBeVisible();
  await carl.context.close();
});

test("the board narrative is drafted, edited and approved, and the PDF downloads", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/reports/board");
  await waitForShell(carl.page);
  await expect(carl.page.getByText("The headline numbers")).toBeVisible();
  await carl.page.getByRole("button", { name: "Draft a summary" }).click();
  const editor = carl.page.getByRole("textbox", { name: "Summary for the board" });
  await expect(editor).toBeVisible();
  await expect(carl.page.getByText("AI draft", { exact: true }).first()).toBeVisible();
  const drafted = await editor.inputValue();
  expect(drafted.length).toBeGreaterThan(0);
  // Appending no figures keeps the draft verifiable against the records.
  await editor.fill(`${drafted}\n\nThe security lead has reviewed this summary.`);
  await carl.page.getByRole("button", { name: "Use in board pack" }).click();
  await expect(carl.page.getByText(/^Approved by Carl Ciso/)).toBeVisible();
  await expect(carl.page.getByText("The security lead has reviewed this summary.")).toBeVisible();
  await expect(carl.page.getByText("Drafted with AI assistance")).toBeVisible();

  const [pdf] = await Promise.all([
    carl.page.waitForEvent("download"),
    carl.page.getByRole("link", { name: "Download PDF" }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^complaient-board-\d{4}-\d{2}-\d{2}\.pdf$/);
  const { stat } = await import("node:fs/promises");
  expect((await stat(await pdf.path())).size).toBeGreaterThan(0);
  await carl.context.close();
});

test("the Executive view shows the home At a glance", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.getByRole("button", { name: "Account menu" }).click();
  const group = carl.page.getByRole("radiogroup", { name: "View mode" });
  const saved = carl.page.waitForResponse(
    (res) => res.request().method() === "POST" && "next-action" in res.request().headers(),
  );
  await group.getByText("Executive", { exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await carl.page.keyboard.press("Escape");
  await carl.page.goto("/");
  await waitForShell(carl.page);
  await expect(carl.page.getByRole("heading", { name: "At a glance", exact: true })).toBeVisible();
  await expect(carl.page.getByRole("link", { name: "Open the board pack" })).toBeVisible();
  // Put the view back so nothing later depends on it.
  await carl.page.getByRole("button", { name: "Account menu" }).click();
  const back = carl.page.waitForResponse(
    (res) => res.request().method() === "POST" && "next-action" in res.request().headers(),
  );
  await carl.page
    .getByRole("radiogroup", { name: "View mode" })
    .getByText("Professional", { exact: true })
    .click();
  expect((await back).ok()).toBe(true);
  await carl.context.close();
});

test("the auditor can read the reports but not edit or approve", async ({ browser }) => {
  const aldo = await signIn(browser, AUDITOR_EMAIL);
  await aldo.page.goto("/reports/soa");
  await waitForShell(aldo.page);
  await expect(aldo.page.getByRole("status").filter({ hasText: /of \d+ decided/ })).toBeVisible();
  await expect(aldo.page.getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  await aldo.page.goto("/reports/board");
  await waitForShell(aldo.page);
  await expect(aldo.page.getByText("The headline numbers")).toBeVisible();
  await expect(aldo.page.getByText(/^Approved by Carl Ciso/)).toBeVisible();
  for (const name of [
    "Draft a summary",
    "Write a summary",
    "Replace the summary",
    "Use in board pack",
  ]) {
    await expect(aldo.page.getByRole("button", { name })).toHaveCount(0);
  }
  await aldo.context.close();
});

test("the board pack for last month shows seven tiles, the movement table, owners and the PDF", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/reports/board");
  await waitForShell(carl.page);
  // Last month, by the calendar (UTC, as the period keys are).
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastKey = `${String(last.getUTCFullYear())}-${String(last.getUTCMonth() + 1).padStart(2, "0")}`;
  const periods = carl.page.getByRole("navigation", { name: "Period" });
  await periods.getByRole("link", { name: lastKey, exact: true }).click();
  await expect(carl.page).toHaveURL(new RegExp(`period=${lastKey}`));
  await waitForShell(carl.page);
  await expect(periods.getByRole("link", { name: lastKey, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const tiles = carl.page
    .getByRole("region", { name: "The headline numbers" })
    .getByRole("listitem");
  await expect(tiles).toHaveCount(7);

  const movement = carl.page.getByRole("table", {
    name: "Weekly movement, the numbers behind the chart",
  });
  // Collapsed under "Show as table", so it is in the page but not yet in the accessibility tree.
  await expect(
    carl.page.getByRole("table", {
      name: "Weekly movement, the numbers behind the chart",
      includeHidden: true,
    }),
  ).toBeAttached();
  await carl.page.getByText("Show as table", { exact: true }).click();
  await expect(movement).toBeVisible();
  // One header row per measure; one column per week: 12 week columns after the row label.
  await expect(movement.getByRole("columnheader")).toHaveCount(13);
  await expect(movement.getByRole("row")).toHaveCount(5);

  const owners = carl.page.getByRole("table", {
    name: "Risks by owner, most open risks first",
  });
  await expect(owners).toBeVisible();
  expect(await owners.locator("tbody tr").count()).toBeGreaterThanOrEqual(1);

  const [pdf] = await Promise.all([
    carl.page.waitForEvent("download"),
    carl.page.getByRole("link", { name: "Download PDF" }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^complaient-board-.*\.pdf$/);
  expect((await readFile(await pdf.path())).subarray(0, 4).toString("latin1")).toBe("%PDF");
  await carl.context.close();
});

test("the reports pages pass axe", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL, { reducedMotion: "reduce" });
  for (const url of ["/reports", "/reports/soa", "/reports/board"]) {
    await carl.page.goto(url);
    await waitForShell(carl.page);
    await settleAnimations(carl.page);
    await expectNoAxeViolations(carl.page);
  }
  await expect(carl.page).toHaveURL(`${WEB_URL}/reports/board`);
  // The red above-appetite badges: the register and the detail page of a risk above appetite.
  const token = await apiToken(CISO_EMAIL);
  const list = (await api(token, "GET", "/api/v1/risks?filter=aboveAppetite&limit=1")).data as {
    items: { id: string; aboveAppetite: boolean | null }[];
  };
  const above = list.items[0];
  if (!above) throw new Error("No risk above appetite exists to check the red badge on");
  await carl.page.goto("/risks");
  await waitForShell(carl.page);
  await expect(carl.page.getByText("Above appetite", { exact: true }).first()).toBeVisible();
  await settleAnimations(carl.page);
  await expectNoAxeViolations(carl.page);
  await carl.page.goto(`/risks/${above.id}`);
  await waitForShell(carl.page);
  await expect(carl.page.getByText("Above appetite", { exact: true }).first()).toBeVisible();
  await settleAnimations(carl.page);
  await expectNoAxeViolations(carl.page);
  await carl.context.close();
});
