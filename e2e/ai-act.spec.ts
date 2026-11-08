import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, CISO_EMAIL, WEB_URL } from "./env";
import { api, apiToken, signIn, turnAiOnViaApi, waitForShell } from "./support";

// Runs after ai-disabled, which leaves the AI assistant on. Anna Admin turns the EU AI Act
// module on in Setup → Modules; Carl Ciso (aiact.manage) adds a credit scoring system and
// classifies it by hand, updates an obligation, then lets the mock AI draft a chatbot's
// answers and suggest steps; Anna turns the module off again, and it disappears (404).
// Serial, no retries: each step builds on the one before.
test.describe.configure({ mode: "serial", retries: 0 });

const stamp = String(Date.now()).slice(-6);
const SCORING = `Loan scoring engine ${stamp}`;
const CHATBOT = `Customer chatbot ${stamp}`;
const MOCK_RATIONALE = "Suggested from the profile — please check.";
const LITERACY = "Make sure staff understand AI";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test.beforeAll(async () => {
  // Self-contained: the AI draft needs the AI on, and a retried run starts with the module off.
  await turnAiOnViaApi();
  await api(await apiToken(ADMIN_EMAIL), "PUT", "/api/v1/organisation/modules/eu_ai_act", {
    enabled: false,
  });
});

/** The questionnaire by hand, for a deployer's credit scoring system: high-risk. */
async function classifyCreditScoringByHand(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "Next" });
  await page.getByRole("radio", { name: /^Yes It learns from data/ }).check();
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "Prohibited" })).toBeVisible();
  await next.click();
  await page.getByRole("radio", { name: /^No Software used in offices/ }).check();
  await next.click();
  await page.getByRole("checkbox", { name: /^Creditworthiness and credit scoring/ }).check();
  await page
    .getByRole("group", { name: "Does it profile people?" })
    .getByRole("radio", { name: /^Yes/ })
    .check();
  await page
    .getByRole("group", { name: "Does one of these describe its job?" })
    .getByRole("radio", { name: /^None of these/ })
    .check();
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "Transparency" })).toBeVisible();
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "Review" })).toBeVisible();
  await page.getByRole("button", { name: "Save classification" }).click();
}

async function addSystem(page: Page, name: string, purpose: string): Promise<void> {
  await page.goto("/ai-act/systems/new");
  await waitForShell(page);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Intended purpose", exact: true }).fill(purpose);
  await page.getByRole("button", { name: "Add system" }).click();
  await expect(page).toHaveURL(/\/ai-act\/systems\/[0-9a-f-]+\/classify$/);
  await expect(page.getByRole("heading", { level: 1, name: `Classify ${name}` })).toBeVisible();
}

test("the administrator turns the EU AI Act module on in Setup → Modules", async ({ browser }) => {
  const { context, page } = await signIn(browser, ADMIN_EMAIL);
  await expect(primaryNav(page).getByRole("link", { name: "EU AI Act" })).toHaveCount(0);
  await page.goto("/setup/modules");
  await waitForShell(page);
  await expect(page.getByRole("heading", { level: 1, name: "Optional modules" })).toBeVisible();
  const card = page.getByRole("article", { name: "EU AI Act" });
  await expect(card.getByText(/build, sell or use AI systems in the EU/)).toBeVisible();
  const toggle = card.getByRole("switch", { name: "EU AI Act module on/off" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByText("The EU AI Act module is on.", { exact: false })).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect(primaryNav(page).getByRole("link", { name: "EU AI Act" })).toBeVisible();
  await context.close();
});

test("a system is added, classified by hand, and an obligation is updated (no AI)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await primaryNav(page).getByRole("link", { name: "EU AI Act" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/ai-act`);
  await expect(page.getByRole("heading", { level: 1, name: "AI systems" })).toBeVisible();
  await expect(page.getByText("Module", { exact: true }).first()).toBeVisible();

  await addSystem(page, SCORING, "Assess the creditworthiness of private loan applicants.");
  await classifyCreditScoringByHand(page);

  // The server's result, before going back to the system.
  await expect(page.getByRole("heading", { level: 2, name: "Result" })).toBeVisible();
  await expect(page.getByText("High-risk", { exact: true })).toBeVisible();
  await expect(
    page.getByText("It evaluates creditworthiness or sets credit scores, a high-risk use."),
  ).toBeVisible();
  await expect(page.getByText("Annex III, point 5(b)")).toBeVisible();
  await page.getByRole("link", { name: "Go to the system" }).click();

  await expect(page.getByRole("heading", { level: 1, name: SCORING })).toBeVisible();
  const classification = page.getByRole("region", { name: "Classification" });
  await expect(classification.getByText("Manual", { exact: true })).toBeVisible();
  await expect(classification.getByText(/^Classified by Carl Ciso on /)).toBeVisible();
  const obligations = page.getByRole("list", { name: "Obligations" });
  for (const title of [
    LITERACY,
    "Use it as instructed",
    "Assess the impact on fundamental rights",
  ]) {
    await expect(obligations.getByRole("heading", { level: 3, name: title })).toBeVisible();
  }

  // Update one obligation: status and note are saved together.
  await page
    .getByRole("combobox", { name: `Status for ${LITERACY}` })
    .selectOption({ label: "In progress" });
  await page
    .getByRole("textbox", { name: `Note for ${LITERACY}` })
    .fill("Training booked for the lending team.");
  await page.getByRole("button", { name: `Save for ${LITERACY}` }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await waitForShell(page);
  await expect(page.getByRole("combobox", { name: `Status for ${LITERACY}` })).toHaveValue(
    "in_progress",
  );
  await expect(page.getByRole("textbox", { name: `Note for ${LITERACY}` })).toHaveValue(
    "Training booked for the lending team.",
  );

  // The overview counts it.
  await page.getByRole("link", { name: "All AI systems" }).click();
  const row = page.getByRole("row", { name: new RegExp(SCORING) });
  await expect(row.getByText("High-risk")).toBeVisible();
  await context.close();
});

test("with the mock AI, a chatbot's answers are drafted, saved as AI-assisted, and steps are suggested", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await addSystem(page, CHATBOT, "A chat assistant that answers customer questions online.");

  await page.getByRole("button", { name: "Draft answers with AI" }).click();
  await expect(page.getByText("AI draft", { exact: true })).toBeVisible();
  await expect(page.getByText("AI suggestion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(MOCK_RATIONALE).first()).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Yes It learns from data/ })).toBeChecked();
  // The person can change anything; here the draft is reviewed and saved as it is.
  await page
    .getByRole("navigation", { name: "Questionnaire steps" })
    .getByRole("button", { name: /Review/ })
    .click();
  await page.getByRole("button", { name: "Save classification" }).click();
  await expect(page.getByText("Limited risk", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Go to the system" }).click();

  const classification = page.getByRole("region", { name: "Classification" });
  await expect(classification.getByText("AI-assisted", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Suggest steps (AI) for ${LITERACY}` }).click();
  const steps = page.getByRole("list", { name: `Suggested steps for ${LITERACY}` });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Add to note" }).click();
  const note = page.getByRole("textbox", { name: `Note for ${LITERACY}` });
  await expect(note).toHaveValue(/^1\. Read Art\. 4/);
  await expect(note).toBeFocused();
  await context.close();
});

test("turning the module off asks first, hides it and its pages are not found", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, ADMIN_EMAIL);
  await page.goto("/setup/modules");
  await waitForShell(page);
  await page.getByRole("switch", { name: "EU AI Act module on/off" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off the EU AI Act module?" });
  await expect(dialog.getByText(/Nothing is deleted/)).toBeVisible();
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("The EU AI Act module is off. Its data is kept.")).toBeVisible();
  await expect(primaryNav(page).getByRole("link", { name: "EU AI Act" })).toHaveCount(0);
  await page.goto("/ai-act");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist");
  await context.close();
});
