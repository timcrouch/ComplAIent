import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { REPORTER_EMAIL, THEME_COOKIE, WEB_URL } from "./env";
import { grantRoleViaApi, signIn, turnAiOffViaApi, turnAiOnViaApi, waitForShell } from "./support";

// Runs after ai-settings, which left the AI assistant on (mock provider). Rita Reporter is a
// contributor: she may report, and nothing else. Serial: the form test switches AI off and on.
test.describe.configure({ mode: "serial", retries: 0 });

const REFERENCE = /^R-\d{4}$/;

test.beforeAll(async () => {
  await grantRoleViaApi(REPORTER_EMAIL, "contributor");
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

const answers = (page: Page) => page.getByRole("group", { name: "Suggested answers" });

test("reports a concern through the conversation and sees it under your concerns", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, REPORTER_EMAIL);
  await page.goto("/report");
  await waitForShell(page);
  await expect(page).toHaveTitle("Report a concern · ComplAIent ISMS");
  const log = page.getByRole("log");
  await expect(log).toHaveAttribute("aria-live", "polite");
  await expect(
    log.getByText(
      "Hi, I'm BeaconBot. I'll help turn what you noticed into a clear report. What are you worried might happen?",
      { exact: true },
    ),
  ).toBeVisible();

  const composer = page.getByLabel("Your answer");
  await composer.fill("People leave laptops in unlocked cars in the car park");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(log.getByText("Which site is this about?")).toBeVisible();
  await answers(page).getByRole("button", { name: "Riga plant" }).click();

  await expect(log.getByText("What could be affected?")).toBeVisible();
  // Focus moves to the new question's first suggested answer, never to the page.
  await expect(answers(page).getByRole("button", { name: "Customer data" })).toBeFocused();
  await answers(page).getByRole("button", { name: "Not sure" }).click();

  await expect(log.getByText("Is anything already protecting against this?")).toBeVisible();
  await expect(answers(page).getByRole("button", { name: "Not sure" })).toBeVisible();
  await answers(page).getByRole("button", { name: "No", exact: true }).click();

  const card = page.getByRole("region", { name: "Here's what I understood" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Here's what I understood" })).toBeFocused();
  await expect(log.getByTestId("assistant-question")).toHaveCount(3);
  await expect(card.getByText("AI's rough estimate")).toBeVisible();
  await expect(card.getByLabel("Site")).toHaveValue(/.+/);
  if ((await card.getByRole("textbox", { name: "Affected thing 1" }).count()) === 0) {
    await card.getByRole("button", { name: "Add something affected" }).click();
    await card.getByRole("textbox", { name: "Affected thing 1" }).fill("Laptop");
  }
  const assetTop = await card
    .getByRole("textbox", { name: "Affected thing 1" })
    .evaluate((control) => control.getBoundingClientRect().top);
  const kindTop = await card
    .getByRole("combobox", { name: "Kind of thing 1" })
    .evaluate((control) => control.getBoundingClientRect().top);
  expect(Math.abs(assetTop - kindTop)).toBeLessThanOrEqual(1);
  // "Not sure" put the question on the list of things to confirm.
  await expect(card.getByRole("textbox", { name: "Thing to confirm 1", exact: true })).toHaveValue(
    "What could be affected?",
  );

  const title = card.getByLabel("Title", { exact: true });
  await expect(title).toHaveValue("People leave laptops in unlocked cars in the car park");
  await title.fill("Laptops left in unlocked cars");
  await card.getByLabel("What would happen then").fill("Customer data could be read by a thief");
  await card.getByRole("button", { name: "Send report" }).click();

  const done = page.getByRole("heading", {
    name: "Thank you. Your concern is reported.",
  });
  await expect(done).toBeVisible();
  await expect(page.getByTestId("report-reference")).toHaveText(REFERENCE);

  await page.getByRole("link", { name: "See your concerns" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/concerns`);
  // Newest first: the one just reported.
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Laptops left in unlocked cars" })
    .first();
  await expect(row.getByText("Waiting for review")).toBeVisible();
  await context.close();
});

test("reports a concern through the form when AI is off", async ({ browser }) => {
  await turnAiOffViaApi();
  try {
    const { context, page } = await signIn(browser, REPORTER_EMAIL);
    await page.goto("/report");
    await waitForShell(page);
    await expect(page.getByRole("log")).toHaveCount(0);
    await expect(page.getByText("Step 1 of 5")).toBeVisible();

    await page
      .getByRole("textbox", { name: "Give it a short title", exact: true })
      .fill("Visitors walk in unescorted");
    await page
      .getByRole("textbox", { name: "Describe what could happen", exact: true })
      .fill("Visitors can walk into the server room without anyone with them.");
    await page.getByRole("button", { name: "Next" }).click();
    await page
      .getByRole("combobox", { name: "Site", exact: true })
      .selectOption({ label: "Munich office" });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("textbox", { name: "What is it?", exact: true }).fill("Server room");
    await page
      .getByRole("combobox", { name: "What kind of thing is it?", exact: true })
      .selectOption({ label: "A building or room" });
    await page.getByRole("button", { name: "Next" }).click();
    await page
      .getByRole("textbox", { name: "What could cause it?", exact: true })
      .fill("An unescorted visitor");
    await page
      .getByRole("textbox", { name: "What would happen then?", exact: true })
      .fill("Equipment could be damaged or taken");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Send report" }).click();

    await expect(
      page.getByRole("heading", {
        name: "Thank you. Your concern is reported.",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("report-reference")).toHaveText(REFERENCE);
    await page.goto("/concerns");
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Visitors walk in unescorted" })
        .first()
        .getByText("Waiting for review"),
    ).toBeVisible();
    await context.close();
  } finally {
    await turnAiOnViaApi();
  }
});

test("Report a concern opens from the navigation, the header, ⌘K and the shortcut", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, REPORTER_EMAIL);
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Report a concern",
  });

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Report a concern" })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/report`);
  await expect(heading).toBeVisible();

  // The header holds the one button on the home page (#14); the page itself has none.
  await page.goto("/");
  await waitForShell(page);
  await expect(page.getByRole("main").getByRole("link", { name: /Report a concern/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("banner")
    .getByRole("link", { name: /Report a concern/ })
    .click();
  await expect(page).toHaveURL(`${WEB_URL}/report`);

  await page.goto("/");
  await waitForShell(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("option", { name: "Report a concern" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/report`);

  await page.goto("/");
  await waitForShell(page);
  await page.keyboard.press("ControlOrMeta+Shift+KeyR");
  await expect(page).toHaveURL(`${WEB_URL}/report`);
  await expect(heading).toBeVisible();

  // On /report the shortcut leaves a half-written form alone.
  await page.goto("/report?mode=form");
  await waitForShell(page);
  const title = page.getByRole("textbox", { name: "Give it a short title", exact: true });
  await title.fill("Half written");
  await page.keyboard.press("ControlOrMeta+Shift+KeyR");
  await expect(page).toHaveURL(`${WEB_URL}/report?mode=form`);
  await expect(title).toHaveValue("Half written");
  await context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`report and concerns pages pass axe in ${theme}`, async ({ browser }) => {
    const { context, page } = await signIn(browser, REPORTER_EMAIL, {
      reducedMotion: "reduce",
    });
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    for (const path of ["/report", "/report?mode=form", "/concerns"]) {
      await page.goto(path);
      await settle(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoAxeViolations(page);
    }

    // The conversation with its answer chips, and the summary card.
    await page.goto("/report");
    await settle(page);
    await page.getByLabel("Your answer").fill("Someone could read our screens through the window");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(answers(page).getByRole("button", { name: "Not sure" })).toBeVisible();
    await expectNoAxeViolations(page);
    for (let i = 0; i < 3; i += 1) {
      await answers(page).getByRole("button", { name: "Not sure" }).click();
      if (i < 2)
        await expect(page.getByRole("log").getByTestId("assistant-question")).toHaveCount(i + 2);
    }
    await expect(page.getByRole("region", { name: "Here's what I understood" })).toBeVisible();
    await expectNoAxeViolations(page);
    await context.close();
  });
}
