import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForLibraryEmbeddings } from "./db";
import { ADMIN_EMAIL, CISO_EMAIL, OWNER_EMAIL, REPORTER_EMAIL, THEME_COOKIE, WEB_URL } from "./env";
import { api, apiToken, grantRoleViaApi, signIn, waitForShell } from "./support";

// Runs after report, which left Rita Reporter's concerns proposed and the AI assistant on (mock
// provider). Carl Ciso (security lead for the whole organisation) reviews. Serial: the tests
// share the risks made below.
test.describe.configure({ mode: "serial", retries: 0 });

const stamp = String(Date.now()).slice(-6);
const RIGA_TITLE = `Server cabinet left unlocked ${stamp}`;
const MUNICH_TITLE = `Visitor badges not returned ${stamp}`;

type Site = { id: string; name: string };
type Draft = Record<string, unknown> & { consequence: string; threat: string; scenario: string };
type Conversation = { id: string; draft: (Draft & { aiEstimate: unknown }) | null };

let rigaRiskId = "";

async function sites(token: string): Promise<{ riga: string; munich: string }> {
  const org = (await api(token, "GET", "/api/v1/organisation")).data as { sites: Site[] };
  const id = (name: string) => {
    const site = org.sites.find((s) => s.name === name);
    if (!site) throw new Error(`No site ${name}`);
    return site.id;
  };
  return { riga: id("Riga plant"), munich: id("Munich office") };
}

/** Rita reports through the conversation (so the risk has an AI estimate and a transcript). */
async function reportThroughConversation(title: string, siteId: string): Promise<string> {
  const rita = await apiToken(REPORTER_EMAIL);
  let conversation = (await api(rita, "POST", "/api/v1/concerns", { text: title }))
    .data as Conversation;
  for (let i = 0; !conversation.draft && i < 8; i += 1) {
    conversation = (
      await api(rita, "POST", `/api/v1/concerns/${conversation.id}/messages`, {
        text: "Not sure",
        notSure: true,
      })
    ).data as Conversation;
  }
  if (!conversation.draft) throw new Error("The assistant never summarised");
  // The submit body is ReportRiskInput: the API takes the estimate from its own draft.
  const draft: Partial<Draft> = { ...conversation.draft };
  delete draft.aiEstimate;
  const risk = await api(rita, "POST", `/api/v1/concerns/${conversation.id}/submit`, {
    ...draft,
    title,
    scenario: draft.scenario || title,
    threat: draft.threat || "Anyone walking past",
    consequence: draft.consequence || "Equipment could be tampered with",
    siteId,
  });
  return (risk.data as { id: string }).id;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await grantRoleViaApi(REPORTER_EMAIL, "contributor");
  const admin = await apiToken(ADMIN_EMAIL);
  const { riga, munich } = await sites(admin);
  await grantRoleViaApi(OWNER_EMAIL, "risk_owner", { type: "site", id: munich });
  rigaRiskId = await reportThroughConversation(RIGA_TITLE, riga);
  await api(await apiToken(REPORTER_EMAIL), "POST", "/api/v1/risks", {
    title: MUNICH_TITLE,
    scenario: "Visitors keep their badges after they leave.",
    threat: "A former visitor walks back in",
    consequence: "Someone could reach the offices unescorted",
    existingSafeguards: "",
    assets: [],
    siteId: munich,
    departmentId: null,
    toConfirm: [],
  });
});

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

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const versions = (page: Page) => page.getByRole("list", { name: "Versions" }).getByRole("listitem");

async function openRigaRisk(page: Page): Promise<void> {
  await page.goto(`/risks/${rigaRiskId}`);
  await waitForShell(page);
}

async function saveInline(scope: Locator, editName: string, fill: () => Promise<void>) {
  await scope.getByRole("button", { name: editName, exact: true }).click();
  await fill();
  await scope.getByRole("button", { name: "Save", exact: true }).click();
  await expect(scope.getByRole("button", { name: editName, exact: true })).toBeFocused();
}

test("the review queue shows Rita's proposed concern", async ({ browser }) => {
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Risks" })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/risks`);
  await expect(page).toHaveTitle("Risks · ComplAIent ISMS");
  await page
    .getByRole("navigation", { name: "Show risks" })
    .getByRole("link", { name: "To review" })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/risks?filter=toReview`);
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Laptops left in unlocked cars" })
    .first();
  await expect(row.getByText("Proposed", { exact: true })).toBeVisible();
  await expect(row.getByText(/^R-\d{4}$/)).toBeVisible();
  await row.getByRole("link", { name: "Laptops left in unlocked cars" }).click();
  await expect(page).toHaveURL(/\/risks\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Drafted with AI assistance")).toBeVisible();
  await context.close();
});

test("reviewer edits fields, uses the AI estimate, sets a treatment and owner, and the history grows", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await openRigaRisk(page);
  await expect(page.getByRole("heading", { level: 1, name: RIGA_TITLE })).toBeVisible();
  await expect(versions(page)).toHaveCount(1);

  const record = region(page, "Record");
  await saveInline(record, "Edit Title", async () => {
    await record.getByLabel("Title", { exact: true }).fill(`${RIGA_TITLE} (checked)`);
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${RIGA_TITLE} (checked)`);

  const assessment = region(page, "Assessment");
  const official = assessment.getByTestId("official-assessment");
  await expect(official.getByText("Not set")).toHaveCount(2);
  await expect(assessment.getByText("AI estimate", { exact: true })).toBeVisible();
  await assessment.getByRole("button", { name: "Use the AI estimate" }).click();
  await expect(official).toContainText("out of 25");
  await expect(official.getByText("Not set")).toHaveCount(0);

  const treatment = region(page, "Treatment");
  await saveInline(treatment, "Edit How would you like to handle this risk?", async () => {
    await treatment.getByRole("radio", { name: "Reduce the risk (mitigate)" }).check();
  });
  await expect(treatment).toContainText("Reduce the risk");

  await saveInline(record, "Edit Owner", async () => {
    await record.getByLabel("Owner", { exact: true }).selectOption({ label: "Carl Ciso" });
  });
  await expect(record).toContainText("Carl Ciso");

  await expect(versions(page)).toHaveCount(5);
  await expect(versions(page).first()).toContainText("Changed: owner");
  await expect(versions(page).first()).toContainText("Carl Ciso");
  await context.close();
});

test("reviewer requests control suggestions, accepts two, rejects one and adds one by search", async ({
  browser,
}) => {
  // The first run downloads the embeddings model in the worker.
  test.setTimeout(660_000);
  await waitForLibraryEmbeddings(540_000);
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await openRigaRisk(page);
  const controls = region(page, "Controls");
  const status = controls.getByTestId("suggestion-status");
  await controls.getByRole("button", { name: "Suggest controls" }).click();
  await expect(status).toHaveText("Finding controls…");
  await expect(status).toHaveText("Suggestions ready", { timeout: 70_000 });

  const suggestions = controls.getByRole("list", { name: "Suggested controls" });
  const cards = suggestions.getByRole("listitem");
  // The mock suggests three library controls and one unknown code, which is discarded.
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByText("Suggested by AI")).toBeVisible();
  const codes = await cards.locator("[data-control-code]").allTextContents();
  const [first, second, third] = codes;
  if (!first || !second || !third) throw new Error("Expected three suggestions");

  await suggestions.getByRole("button", { name: `Accept ${first}` }).click();
  await expect(suggestions.getByRole("button", { name: `Accept ${second}` })).toBeFocused();
  await suggestions.getByRole("button", { name: `Accept ${second}` }).click();
  await suggestions
    .getByLabel(`Your reason for ${third} (optional)`)
    .fill("Not relevant for this cabinet");
  await suggestions.getByRole("button", { name: `Reject ${third}` }).click();
  await expect(cards).toHaveCount(0);

  const accepted = controls.getByRole("list", { name: "Accepted controls" });
  await expect(accepted.getByRole("listitem")).toHaveCount(2);

  const search = controls.getByLabel("Search the library");
  await search.fill("backup");
  await search.press("Enter");
  const results = controls.getByRole("list", { name: "Library controls" });
  const add = results.getByRole("button", { name: /^Add / }).first();
  const label = (await add.textContent()) ?? "";
  await add.click();
  await expect(search).toBeFocused();
  await expect(accepted.getByRole("listitem")).toHaveCount(3);
  await expect(accepted).toContainText(label.replace(/^Add/, "").trim());
  await context.close();
});

test("a risk owner at another site does not see the risk", async ({ browser }) => {
  const { context, page } = await signIn(browser, OWNER_EMAIL);
  await page.goto("/risks");
  await waitForShell(page);
  await expect(page.getByRole("link", { name: MUNICH_TITLE })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(RIGA_TITLE) })).toHaveCount(0);
  await page.goto(`/risks/${rigaRiskId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist");
  await context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`risk pages pass axe in ${theme}`, async ({ browser }) => {
    const { context, page } = await signIn(browser, CISO_EMAIL, { reducedMotion: "reduce" });
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    for (const path of ["/risks", `/risks/${rigaRiskId}`, `/risks/${rigaRiskId}/conversation`]) {
      await page.goto(path);
      await settle(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoAxeViolations(page);
    }
    // An open inline editor and the library search results.
    await page.goto(`/risks/${rigaRiskId}`);
    await settle(page);
    const record = region(page, "Record");
    await record.getByRole("button", { name: "Edit What could happen", exact: true }).click();
    const controls = region(page, "Controls");
    await controls.getByLabel("Search the library").fill("access");
    await controls.getByLabel("Search the library").press("Enter");
    await expect(controls.getByRole("list", { name: "Library controls" })).toBeVisible();
    await expectNoAxeViolations(page);
    await context.close();
  });
}
