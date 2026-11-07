import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL, CISO_EMAIL, REPORTER_EMAIL, WEB_URL } from "./env";
import { api, apiToken, signIn, turnAiOnViaApi, waitForShell } from "./support";

// Runs after workspace, which left the AI assistant on and every framework suggestion resolved.
// The administrator switches AI off in the settings screen; every slice workflow must still
// work by hand (spec §8.5, "AI disabled mode"). Records made with AI earlier keep their AI
// labels (honest provenance); what is checked here is that nothing NEW is offered or labelled
// as AI on the pages and records this spec makes. AI is switched back on afterwards.
test.describe.configure({ mode: "serial", retries: 0 });

const stamp = String(Date.now()).slice(-6);
const TITLE = `Spare keys hang by the door ${stamp}`;
const AI_WORDING = /suggested by ai|drafted with ai|ai estimate|ai's rough estimate/i;

const summary = (page: Page) => page.getByRole("region", { name: "Status" });

test.afterAll(async () => {
  await turnAiOnViaApi();
});

test("with AI off, a concern is reported by form, controls are added by search, frameworks are chosen manually, and nothing says suggested", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // 1. The administrator switches the AI assistant off in Settings → AI assistant.
  {
    const { context, page } = await signIn(browser, ADMIN_EMAIL);
    await page.goto("/settings/ai");
    await waitForShell(page);
    const master = page.getByRole("switch", { name: "AI assistant on/off" });
    await expect(master).toBeChecked();
    await master.click();
    await expect(summary(page).getByText("The AI assistant is off.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "AI assistant on/off" })).not.toBeChecked();
    await context.close();
  }

  // 2. Rita Reporter gets the step form, never the conversation.
  {
    const { context, page } = await signIn(browser, REPORTER_EMAIL);
    await page.goto("/report");
    await waitForShell(page);
    await expect(page.getByRole("log")).toHaveCount(0);
    await expect(page.getByLabel("Your answer")).toHaveCount(0);
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
    await page.getByRole("textbox", { name: "Give it a short title", exact: true }).fill(TITLE);
    await page
      .getByRole("textbox", { name: "Describe what could happen", exact: true })
      .fill("The spare office keys hang on a hook next to the entrance.");
    await page.getByRole("button", { name: "Next" }).click();
    await page
      .getByRole("combobox", { name: "Site", exact: true })
      .selectOption({ label: "Riga plant" });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("textbox", { name: "What is it?", exact: true }).fill("Office keys");
    await page
      .getByRole("combobox", { name: "What kind of thing is it?", exact: true })
      .selectOption({ label: "A building or room" });
    await page.getByRole("button", { name: "Next" }).click();
    await page
      .getByRole("textbox", { name: "What could cause it?", exact: true })
      .fill("A visitor takes the keys");
    await page
      .getByRole("textbox", { name: "What would happen then?", exact: true })
      .fill("Someone could enter the office at night");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(AI_WORDING)).toHaveCount(0);
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(
      page.getByRole("heading", { name: "Thank you. Your concern is reported." }),
    ).toBeVisible();
    await context.close();
  }

  // 3. Carl Ciso reviews it: no "Suggest controls", and the library search adds a control.
  const carl = await apiToken(CISO_EMAIL);
  const list = (await api(carl, "GET", "/api/v1/risks?filter=toReview&limit=100")).data as {
    items: { id: string; title: string }[];
  };
  const risk = list.items.find((r) => r.title === TITLE);
  if (!risk) throw new Error("The reported risk is not in Carl's review queue");
  const detail = (await api(carl, "GET", `/api/v1/risks/${risk.id}`)).data as {
    aiAssisted: boolean;
    aiEstimate: unknown;
    can: { edit: boolean };
  };
  expect(detail).toMatchObject({ aiAssisted: false, aiEstimate: null, can: { edit: true } });
  {
    const { context, page } = await signIn(browser, CISO_EMAIL);
    await page.goto(`/risks/${risk.id}`);
    await waitForShell(page);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    const controls = page.getByRole("region", { name: "Controls", exact: true });
    await expect(controls.getByRole("button", { name: "Suggest controls" })).toHaveCount(0);
    await expect(controls.getByRole("list", { name: "Suggested controls" })).toHaveCount(0);

    const search = controls.getByLabel("Search the library");
    await search.fill("access");
    await search.press("Enter");
    const add = controls
      .getByRole("list", { name: "Library controls" })
      .getByRole("button", { name: /^Add / })
      .first();
    await add.click();
    await expect(search).toBeFocused();
    const accepted = controls.getByRole("list", { name: "Accepted controls" });
    await expect(accepted.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText(AI_WORDING)).toHaveCount(0);
    await context.close();
  }

  // 4. The administrator chooses frameworks by hand: no suggestion button, nothing suggested.
  {
    const { context, page } = await signIn(browser, ADMIN_EMAIL);
    await page.goto("/setup/frameworks");
    await waitForShell(page);
    await expect(page.getByRole("checkbox").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Suggest from your answers" })).toHaveCount(0);
    await expect(page.getByText(/suggested by ai/i)).toHaveCount(0);
    await expect(page.getByText(/please check/i)).toHaveCount(0);
    const gdpr = page.getByRole("checkbox", { name: /^GDPR/ });
    await gdpr.uncheck();
    await gdpr.check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(`${WEB_URL}/setup/risk-appetite`);
    await context.close();
  }

  const org = (await api(await apiToken(ADMIN_EMAIL), "GET", "/api/v1/organisation")).data as {
    frameworks: { name: string; status: string }[];
  };
  expect(org.frameworks.filter((f) => f.status === "suggested")).toEqual([]);
  expect(org.frameworks.find((f) => f.name.startsWith("GDPR"))?.status).toBe("confirmed");
});
