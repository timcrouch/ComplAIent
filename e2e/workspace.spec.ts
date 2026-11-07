import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  APPROVER_EMAIL,
  CISO_EMAIL,
  REPORTER_EMAIL,
  THEME_COOKIE,
  WEB_URL,
} from "./env";
import { api, apiToken, signIn, turnAiOnViaApi, waitForShell } from "./support";

// Runs after approval, which leaves approved, returned and in-review risks and Rita Reporter's
// concerns in place. Self-contained: every count asserted is read from the API at the moment
// the page is shown, and the risks this spec needs are made below. Serial: tests share them.
test.describe.configure({ mode: "serial", retries: 0 });

const stamp = String(Date.now()).slice(-6);
const HIGH_TITLE = `Firewall rules never reviewed ${stamp}`;
const RITA_TITLE = `Printer stores scanned payslips ${stamp}`;

type Detail = { id: string; version: number };
type Workspace = {
  statements: { key: string; count: number; href: string }[];
  dimensions: {
    risks: { total: number; aboveAppetite: number; approved: number };
    controls: { accepted: number; withEvidence: number };
  } | null;
};

let controlCode = "";

/**
 * Rita reports a risk; Carl scores it (25 is above appetite), names himself owner, accepts one
 * control (no evidence) and submits it.
 */
async function reportAndSubmit(title: string): Promise<string> {
  const [rita, carl] = [await apiToken(REPORTER_EMAIL), await apiToken(CISO_EMAIL)];
  const carlId = ((await api(carl, "GET", "/api/v1/me")).data as { id: string }).id;
  let risk = (
    await api(rita, "POST", "/api/v1/risks", {
      title,
      scenario: "Nobody has looked at the rules since the office moved.",
      threat: "An old rule left open",
      consequence: "Someone outside could reach the file server",
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
      changes: { likelihood: 5, impact: 5, treatment: "mitigate", ownerId: carlId },
    })
  ).data as Detail;
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/controls`, {
      expectedVersion: risk.version,
      controlCode,
    })
  ).data as Detail;
  await api(carl, "POST", `/api/v1/risks/${risk.id}/submit`, { expectedVersion: risk.version });
  return risk.id;
}

async function workspaceOf(email: string): Promise<Workspace> {
  return (await api(await apiToken(email), "GET", "/api/v1/workspace")).data as Workspace;
}

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

/** The sentence the home page must show for a statement, from the API's count. */
function sentence(key: string, n: number): string {
  switch (key) {
    case "aboveAppetite":
      return `${String(n)} ${plural(n, "risk is", "risks are")} above your appetite`;
    case "evidenceMissing":
      return `${String(n)} ${plural(n, "evidence item is", "evidence items are")} missing`;
    case "concernsUpdated":
      return n === 1 ? "Your concern was reviewed" : `${String(n)} of your concerns were reviewed`;
    default:
      throw new Error(`No sentence for ${key}`);
  }
}

function countOf(w: Workspace, key: string): number {
  const found = w.statements.find((s) => s.key === key);
  if (!found) throw new Error(`No ${key} statement`);
  return found.count;
}

const needs = (page: Page) => page.getByRole("list", { name: "What needs you" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const library = (await api(await apiToken(ADMIN_EMAIL), "GET", "/api/v1/library/controls"))
    .data as { items: { code: string }[] };
  controlCode = library.items[0]?.code ?? "";
  if (!controlCode) throw new Error("The control library is empty");
});

test("after approval, Carl's home shows updated counts that open the records", async ({
  browser,
}) => {
  const before = await workspaceOf(CISO_EMAIL);
  const id = await reportAndSubmit(HIGH_TITLE);
  // Above appetite, so Adam Approver (not Carl, its reviewer) approves it.
  const adam = await apiToken(APPROVER_EMAIL);
  const risk = (await api(adam, "GET", `/api/v1/risks/${id}`)).data as Detail;
  await api(adam, "POST", `/api/v1/risks/${id}/approve`, { expectedVersion: risk.version });

  const after = await workspaceOf(CISO_EMAIL);
  expect(after.dimensions?.risks.approved).toBe((before.dimensions?.risks.approved ?? 0) + 1);
  expect(after.dimensions?.risks.total).toBe((before.dimensions?.risks.total ?? 0) + 1);
  const above = countOf(after, "aboveAppetite");
  const missing = countOf(after, "evidenceMissing");

  const { context, page } = await signIn(browser, CISO_EMAIL);
  const dims = after.dimensions;
  if (!dims) throw new Error("Carl reads risks, so he has dimensions");
  await expect(
    page.getByText(
      `${String(dims.risks.aboveAppetite)} of ${String(dims.risks.total)} risks are above your appetite`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${String(dims.controls.withEvidence)} of ${String(dims.controls.accepted)} accepted controls have evidence`,
    ),
  ).toBeVisible();
  // No compliance score or percentage. The risk picture's "show as table" details (a risk's
  // likelihood x impact "Score" column) and "n risks are not scored yet" are not one.
  await expect(
    page
      .getByRole("main")
      .getByText(/\bscore\b|%/i)
      .and(page.locator(":not(details *)")),
  ).toHaveCount(0);

  await needs(page)
    .getByRole("link", { name: sentence("evidenceMissing", missing) })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/risks?filter=evidenceMissing`);
  await expect(page.getByRole("link", { name: HIGH_TITLE })).toBeVisible();

  await page.goto("/");
  await waitForShell(page);
  await needs(page)
    .getByRole("link", { name: sentence("aboveAppetite", above) })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/risks?filter=aboveAppetite`);
  await expect(page.getByRole("link", { name: HIGH_TITLE })).toBeVisible();
  await context.close();
});

test("Rita's home shows that her concern was reviewed", async ({ browser }) => {
  await reportAndSubmit(RITA_TITLE);
  const reviewed = countOf(await workspaceOf(REPORTER_EMAIL), "concernsUpdated");

  const { context, page } = await signIn(browser, REPORTER_EMAIL);
  const concerns = page.getByRole("region", { name: "Your concerns" });
  const mine = concerns.getByRole("listitem").filter({ hasText: RITA_TITLE });
  await expect(mine).toContainText("Reviewed — waiting for approval");
  // Reporting is offered once, in the header on every page (#14).
  await expect(
    page.getByRole("banner").getByRole("link", { name: /Report a concern/ }),
  ).toHaveAttribute("href", "/report");
  await expect(page.getByRole("main").getByRole("link", { name: /Report a concern/ })).toHaveCount(
    0,
  );

  await needs(page)
    .getByRole("link", { name: sentence("concernsUpdated", reviewed) })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/concerns`);
  await expect(page.getByRole("list", { name: "Your concerns" })).toContainText(RITA_TITLE);
  await context.close();
});

test("admin asks for framework suggestions, sees reasoning, and confirms one", async ({
  browser,
}) => {
  await turnAiOnViaApi();
  const { context, page } = await signIn(browser, ADMIN_EMAIL);
  await page.goto("/setup/frameworks");
  await waitForShell(page);
  const nis2 = page.getByRole("checkbox", { name: /^NIS2/ });
  await expect(nis2).not.toBeChecked();
  const suggest = page.getByRole("button", { name: "Suggest from your answers" });
  await suggest.click();
  // GDPR and ISO 27001 are confirmed already (org-setup), so the mock's only new one is NIS2.
  await expect(page.getByTestId("suggest-status")).toHaveText(
    "1 framework suggested. Check each one before you save.",
  );
  await expect(suggest).toBeFocused();
  const card = page.getByRole("listitem").filter({ has: nis2 });
  await expect(card.getByText("Suggested by AI")).toBeVisible();
  await expect(card.getByText("Suggested from your answers — please check.")).toBeVisible();
  await expect(nis2).not.toBeChecked();

  await nis2.check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/setup/risk-appetite`);
  await context.close();

  const org = (await api(await apiToken(ADMIN_EMAIL), "GET", "/api/v1/organisation")).data as {
    frameworks: { name: string; status: string; source: string; reasoning: string | null }[];
  };
  const confirmed = org.frameworks.find((f) => f.name.startsWith("NIS2"));
  expect(confirmed).toMatchObject({
    status: "confirmed",
    source: "ai",
    reasoning: "Suggested from your answers — please check.",
  });
  expect(org.frameworks.filter((f) => f.status === "suggested")).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`home passes axe in ${theme}`, async ({ browser }) => {
    for (const email of [CISO_EMAIL, REPORTER_EMAIL]) {
      const { context, page } = await signIn(browser, email, { reducedMotion: "reduce" });
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
      await page.goto("/");
      await waitForShell(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(needs(page)).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations).toEqual([]);
      await context.close();
    }
  });
}
