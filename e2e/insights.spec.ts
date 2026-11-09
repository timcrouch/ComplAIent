import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  APPROVER_EMAIL,
  CISO_EMAIL,
  OWNER_EMAIL,
  REPORTER_EMAIL,
  THEME_COOKIE,
  WEB_URL,
} from "./env";
import { api, apiToken, grantRoleViaApi, signIn, waitForShell } from "./support";

// Runs after workspace. Self-contained: it reports its own risk (unique title) through the API
// and reads nothing from other specs. A 4 x 4 risk (score 16) is above the default appetite, so
// Adam Approver, not Carl, approves it. Serial: the tests share the one risk.
test.describe.configure({ mode: "serial", retries: 0 });

const title = `Visuals risk ${String(Date.now()).slice(-6)}`;
let riskId = "";
let version = 0;
const noExpectedTitle = `No expected score ${String(Date.now()).slice(-6)}`;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await grantRoleViaApi(APPROVER_EMAIL, "risk_approver");
  await grantRoleViaApi(REPORTER_EMAIL, "contributor");
  await grantRoleViaApi(OWNER_EMAIL, "risk_owner");
  const [rita, carl] = [await apiToken(REPORTER_EMAIL), await apiToken(CISO_EMAIL)];
  const library = (await api(carl, "GET", "/api/v1/library/controls")).data as {
    items: { code: string }[];
  };
  const controlCode = library.items[0]?.code;
  if (!controlCode) throw new Error("The control library is empty");
  const carlId = ((await api(carl, "GET", "/api/v1/me")).data as { id: string }).id;
  let risk = (
    await api(rita, "POST", "/api/v1/risks", {
      title,
      scenario: "A supplier portal is reachable without a second factor.",
      threat: "Credential theft",
      consequence: "Orders could be changed by a stranger",
      existingSafeguards: "",
      assets: [],
      siteId: null,
      departmentId: null,
      toConfirm: [],
    })
  ).data as { id: string; version: number };
  risk = (
    await api(carl, "PATCH", `/api/v1/risks/${risk.id}`, {
      expectedVersion: risk.version,
      changes: {
        likelihood: 4,
        impact: 4,
        treatment: "mitigate",
        residualLikelihood: 2,
        residualImpact: 2,
        ownerId: carlId,
      },
    })
  ).data as { id: string; version: number };
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/controls`, {
      expectedVersion: risk.version,
      controlCode,
    })
  ).data as { id: string; version: number };
  riskId = risk.id;
  version = risk.version;

  // Olga sees only what she reports or owns: one scored risk with no expected score, so her
  // Expected map has nothing placed.
  const olga = await apiToken(OWNER_EMAIL);
  const bare = (
    await api(olga, "POST", "/api/v1/risks", {
      title: noExpectedTitle,
      scenario: "A shared drive has no retention rule.",
      threat: "Data loss",
      consequence: "Old files pile up",
      existingSafeguards: "",
      assets: [],
      siteId: null,
      departmentId: null,
      toConfirm: [],
    })
  ).data as { id: string; version: number };
  await api(carl, "PATCH", `/api/v1/risks/${bare.id}`, {
    expectedVersion: bare.version,
    changes: { likelihood: 3, impact: 3, treatment: "mitigate" },
  });
});

const header = (page: Page) => page.getByTestId("risk-header");
const current = (page: Page) => page.locator('[aria-current="step"]');

async function settle(page: Page): Promise<void> {
  await waitForShell(page);
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

test("a slow risk-detail navigation acknowledges the selected row", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  let detailRequests = 0;
  await carl.page.route(`**/risks/${riskId}*`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("_rsc")) return route.continue();
    detailRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });

  await carl.page.goto("/risks");
  await waitForShell(carl.page);
  const risk = carl.page.getByRole("link", { name: title, exact: true });

  await risk.evaluate((link) => (link as HTMLElement).click());
  await expect(risk).toHaveAttribute("aria-busy", "true", { timeout: 100 });
  await expect(risk.locator("[data-link-pending-indicator]")).toBeVisible();
  const requestsAfterFirstClick = detailRequests;
  await risk.evaluate((link) => (link as HTMLElement).click());
  await carl.page.waitForTimeout(150);
  expect(detailRequests).toBe(requestsAfterFirstClick);

  await expect(carl.page).toHaveURL(`${WEB_URL}/risks/${riskId}`);
  await carl.context.close();
});

test("the risk shows its current and expected scores and where it is on the way to approval", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto(`/risks/${riskId}`);
  await waitForShell(carl.page);
  await expect(header(carl.page)).toContainText("Now 16");
  await expect(header(carl.page)).toContainText("above appetite");
  await expect(header(carl.page)).toContainText("Expected 4");
  await expect(current(carl.page)).toHaveCount(1);
  await expect(current(carl.page)).toContainText("Being reviewed");
  await carl.context.close();
});

test("the map places the risk by its current score, then by its expected score", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/risks?view=map");
  await waitForShell(carl.page);
  const nowCell = carl.page.getByRole("link", {
    name: /^Above appetite: \d+ risks?, likelihood Likely, impact Major$/,
  });
  await expect(nowCell).toHaveCount(1);
  await nowCell.click();
  await expect(carl.page.getByRole("link", { name: title })).toBeVisible();

  await carl.page.goto("/risks?view=map");
  await carl.page.getByRole("link", { name: "Expected", exact: true }).click();
  await expect(carl.page).toHaveURL(/basis=residual/);
  // Likelihood 2 x impact 2: within appetite.
  const expectedCell = carl.page.getByRole("link", {
    name: /^Within appetite: \d+ risks?, likelihood \w[\w ]*, impact \w[\w ]*$/,
  });
  await expect(expectedCell.first()).toBeVisible();
  await carl.context.close();
});

test("an above-appetite map cell is drawn in the critical colour", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await carl.page.goto("/risks?view=map");
  await waitForShell(carl.page);
  const cell = carl.page
    .getByRole("link", {
      name: /^Above appetite: \d+ risks?, likelihood Likely, impact Major$/,
    })
    .first();
  await expect(cell).toBeVisible();
  const { cellColor, token } = await carl.page.evaluate(
    (el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--isms-critical)";
      document.body.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      return { cellColor: getComputedStyle(el).color, token };
    },
    await cell.elementHandle(),
  );
  expect(token).toMatch(/^rgb/);
  expect(cellColor).toBe(token);
  await carl.context.close();
});

test("an Expected map with nothing placed says so and links to the risks that lack a score", async ({
  browser,
}) => {
  const olga = await signIn(browser, OWNER_EMAIL);
  await olga.page.goto("/risks?view=map&basis=residual");
  await waitForShell(olga.page);
  const note = olga.page.getByRole("note");
  await expect(note).toContainText("No risks have an expected score yet.");
  await note.getByRole("link", { name: /^Show the \d+ risks?$/ }).click();
  await expect(olga.page).toHaveURL(/\/risks\?filter=noExpectedScore/);
  await expect(olga.page.getByRole("link", { name: noExpectedTitle })).toBeVisible();
  await olga.context.close();
});

test("submitted and approved by someone else, the journey ends at Approved", async ({
  browser,
}) => {
  const carl = await apiToken(CISO_EMAIL);
  await api(carl, "POST", `/api/v1/risks/${riskId}/submit`, { expectedVersion: version });

  const adam = await signIn(browser, APPROVER_EMAIL);
  await adam.page.goto(`/risks/${riskId}`);
  await waitForShell(adam.page);
  await expect(current(adam.page)).toContainText("Waiting for approval");
  const approval = adam.page.getByRole("region", { name: "Approval", exact: true });
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(adam.page.getByTestId("risk-announcer")).toHaveText("Risk approved.");
  await expect(current(adam.page)).toContainText("Approved");
  await adam.context.close();
});

test("home shows the risk picture with this week's counts in the table", async ({ browser }) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await expect(carl.page.getByRole("heading", { name: "Risk picture" })).toBeVisible();
  await carl.page.getByText("Show as table").last().click();
  const table = carl.page.getByRole("table", {
    name: "Risks reported, approved and marked as treated per week",
  });
  await expect(table).toBeVisible();
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(13);
  // The last row is the current week: this spec reported and approved a risk in it.
  const cells = rows.last().getByRole("cell");
  expect(Number(await cells.nth(0).textContent())).toBeGreaterThanOrEqual(1);
  expect(Number(await cells.nth(1).textContent())).toBeGreaterThanOrEqual(1);
  await carl.context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`the map and the risk pass axe in ${theme}`, async ({ browser }) => {
    const carl = await signIn(browser, CISO_EMAIL, { reducedMotion: "reduce" });
    await carl.context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    for (const url of ["/risks?view=map", "/risks?view=map&basis=residual", `/risks/${riskId}`]) {
      await carl.page.goto(url);
      await settle(carl.page);
      await expect(carl.page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoAxeViolations(carl.page);
    }
    await carl.context.close();
  });
}
