import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CISO_EMAIL, OWNER_EMAIL, REPORTER_EMAIL, THEME_COOKIE, WEB_URL } from "./env";
import { api, apiToken, grantRoleViaApi, signIn, waitForShell } from "./support";

// Runs after insights. Self-contained: it makes its own approved risk (unique title, owned by
// Olga Owner, with an accepted control) through the API and reads nothing from other specs.
// A 2 x 2 risk is within appetite, so Carl Ciso, its reviewer, approves it. Serial: the tests
// share the one risk and walk it through treatment, closing, a control test and reassessment.
test.describe.configure({ mode: "serial", retries: 0 });

const stamp = String(Date.now()).slice(-6);
const title = `Loop risk ${stamp}`;
const actionTitle = `Fit the lock ${stamp}`;
let riskId = "";
let controlCode = "";

type Detail = { id: string; version: number };

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await grantRoleViaApi(OWNER_EMAIL, "risk_owner");
  await grantRoleViaApi(REPORTER_EMAIL, "contributor");
  const [rita, carl, olga] = [
    await apiToken(REPORTER_EMAIL),
    await apiToken(CISO_EMAIL),
    await apiToken(OWNER_EMAIL),
  ];
  const library = (await api(carl, "GET", "/api/v1/library/controls")).data as {
    items: { code: string }[];
  };
  const code = library.items[0]?.code;
  if (!code) throw new Error("The control library is empty");
  controlCode = code;
  const olgaId = ((await api(olga, "GET", "/api/v1/me")).data as { id: string }).id;
  let risk = (
    await api(rita, "POST", "/api/v1/risks", {
      title,
      scenario: "The back door of the server room is left unlocked at night.",
      threat: "Unauthorised entry",
      consequence: "Equipment could be tampered with",
      existingSafeguards: "",
      assets: [],
      siteId: null,
      departmentId: null,
      toConfirm: [],
    })
  ).data as Detail;
  risk = (
    await api(carl, "PATCH", `/api/v1/risks/${risk.id}`, {
      expectedVersion: risk.version,
      changes: {
        likelihood: 2,
        impact: 2,
        treatment: "mitigate",
        residualLikelihood: 1,
        residualImpact: 1,
        ownerId: olgaId,
      },
    })
  ).data as Detail;
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/controls`, {
      expectedVersion: risk.version,
      controlCode,
    })
  ).data as Detail;
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/submit`, { expectedVersion: risk.version })
  ).data as Detail;
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/approve`, { expectedVersion: risk.version })
  ).data as Detail;
  riskId = risk.id;
});

const current = (page: Page) => page.locator('[aria-current="step"]');

async function settle(page: Page): Promise<void> {
  await waitForShell(page);
  // The control page streams in behind its loading screen: wait for the real page.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

test("the reviewer adds an action for Rita Reporter, due tomorrow", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto(`/risks/${riskId}`);
  await waitForShell(carl.page);
  const plan = carl.page.getByRole("group", { name: "Treatment plan" });
  await expect(plan.getByText("No actions yet.")).toBeVisible();
  await plan.getByRole("button", { name: "Add action" }).click();
  const dialog = carl.page.getByRole("dialog", { name: "Add an action" });
  await dialog.getByLabel("What needs doing").fill(actionTitle);
  await dialog.getByLabel("Who will do it").selectOption({ label: "Rita Reporter" });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel("Due date").fill(tomorrow);
  await dialog.getByRole("button", { name: "Add action" }).click();
  await expect(dialog).toBeHidden();
  await expect(plan.getByText(actionTitle, { exact: true }).first()).toBeVisible();
  await expect(plan.getByText("Assigned to Rita Reporter")).toBeVisible();
  await expect(plan.getByText("0 of 1 done")).toBeVisible();
  // An open action blocks closing: the page says so and offers no way to mark it treated.
  await expect(carl.page.getByText("Finish or cancel the open actions first")).toBeVisible();
  await expect(carl.page.getByRole("button", { name: "Mark as treated" })).toHaveCount(0);
  await carl.context.close();
});

test("Rita sees the action in Tasks and marks it done", async ({ browser }) => {
  const rita = await signIn(browser, REPORTER_EMAIL);
  await rita.page.goto("/tasks");
  await waitForShell(rita.page);
  const item = rita.page.getByRole("listitem").filter({ hasText: actionTitle });
  await expect(item).toBeVisible();
  await expect(item.getByText("Action", { exact: true })).toBeVisible();
  await item.getByRole("button", { name: /Mark done/ }).click();
  const dialog = rita.page.getByRole("dialog", { name: `Mark done: ${actionTitle}` });
  await dialog.getByLabel("Note (optional)").fill("Lock fitted and keys logged.");
  await dialog.getByRole("button", { name: "Mark done" }).click();
  await expect(rita.page.getByTestId("tasks-announcer")).toHaveText(`${actionTitle} is done.`);
  await expect(item.getByText("Done", { exact: true })).toBeVisible();
  await expect(item.getByRole("button", { name: /Mark done/ })).toHaveCount(0);
  await rita.context.close();
});

test("marking the risk as treated ends the journey at Treated and shows the next review", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto(`/risks/${riskId}`);
  await waitForShell(carl.page);
  await expect(carl.page.getByText("1 of 1 done")).toBeVisible();
  await expect(carl.page.getByText(/^Next review due /).first()).toBeVisible();
  await carl.page.getByRole("button", { name: "Mark as treated" }).click();
  const dialog = carl.page.getByRole("dialog", { name: "Mark this risk as treated" });
  await dialog.getByLabel("What was done").fill("The lock is fitted and checked nightly.");
  await dialog.getByRole("button", { name: "Mark as treated" }).click();
  await expect(carl.page.getByTestId("risk-announcer")).toHaveText(
    "The risk is marked as treated.",
  );
  await expect(current(carl.page)).toContainText("Treated");
  await expect(carl.page.getByText(/Marked as treated on .* by Carl/)).toBeVisible();
  await expect(carl.page.getByText(/^Next review due /).first()).toBeVisible();
  await carl.context.close();
});

test("a control test on the control's page shows in the In operation panel", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto(`/library/${controlCode}`);
  await waitForShell(carl.page);
  const panel = carl.page.getByRole("region", { name: "In operation" });
  await expect(panel.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await carl.page.getByLabel("Effective", { exact: true }).check();
  await carl.page
    .getByLabel("What was checked", { exact: true })
    .first()
    .fill("Walked the site at night and tried the door.");
  await carl.page.getByRole("button", { name: "Record test" }).click();
  await expect(carl.page.getByText("Test recorded.")).toBeVisible();
  const latest = panel.getByRole("heading", { name: "Latest test" }).locator("..");
  await expect(latest).toContainText("Effective");
  await expect(latest).toContainText("Carl");
  await carl.context.close();
});

test("reassessing makes the risk editable again", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto(`/risks/${riskId}`);
  await waitForShell(carl.page);
  await carl.page.getByRole("button", { name: "Reassess" }).click();
  const dialog = carl.page.getByRole("dialog", { name: "Reassess this risk" });
  await dialog.getByLabel("Why is it being reassessed?").fill("The site layout changed.");
  await dialog.getByRole("button", { name: "Reassess" }).click();
  await expect(carl.page.getByTestId("risk-announcer")).toHaveText(
    "The risk is open for reassessment.",
  );
  await expect(current(carl.page)).not.toContainText("Treated");
  await expect(carl.page.getByRole("button", { name: "Mark as treated" })).toHaveCount(0);
  // The API agrees: an edit is accepted again.
  const token = await apiToken(CISO_EMAIL);
  const risk = (await api(token, "GET", `/api/v1/risks/${riskId}`)).data as Detail;
  await api(token, "PATCH", `/api/v1/risks/${riskId}`, {
    expectedVersion: risk.version,
    changes: { likelihood: 3 },
  });
  await carl.context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`the risk page and the control page pass axe in ${theme}`, async ({ browser }) => {
    const carl = await signIn(browser, CISO_EMAIL, { reducedMotion: "reduce" });
    await carl.context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    for (const url of [`/risks/${riskId}`, `/library/${controlCode}`]) {
      await carl.page.goto(url);
      await settle(carl.page);
      await expect(carl.page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoAxeViolations(carl.page);
    }
    await carl.context.close();
  });
}
