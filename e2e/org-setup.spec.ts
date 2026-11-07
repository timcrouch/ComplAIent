import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { auditActions } from "./db";
import { ADMIN_EMAIL, ADMIN_STATE, REPORTER_STATE, THEME_COOKIE, WEB_URL } from "./env";
import { submitKeycloakForm, waitForShell } from "./support";

// Runs after the shell project on a fresh isms_test (auth.setup.ts resets it), in file order:
// the first test sets the organisation up; the others use what it saved. Serial, so a failure
// skips the rest; no retries, since a retry would start from a half set-up organisation and
// fail somewhere other than the real fault.
test.describe.configure({ mode: "serial", retries: 0 });

const STEPS = [
  "/setup/organisation",
  "/setup/sites",
  "/setup/frameworks",
  "/setup/risk-appetite",
  "/setup/people",
  "/setup/review",
] as const;

const saveAndContinue = (page: Page) =>
  page.getByRole("button", { name: "Save and continue" }).click();

/** Presses Tab until `target` has focus (keyboard only), failing after `max` presses. */
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Focus never reached the target with Tab");
}

/** The focused control is :focus-visible and it, or the card it sits in, shows a ring. */
async function expectVisibleFocus(page: Page): Promise<void> {
  const shown = await page.evaluate(async () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el?.matches(":focus-visible")) return false;
    // Let the ring's transition finish: it starts from transparent, zero-size layers.
    const settle = (node: Element | null) =>
      Promise.all((node?.getAnimations() ?? []).map((a) => a.finished.catch(() => undefined)));
    await Promise.all([settle(el), settle(el.closest("label"))]);
    const visible = (node: Element | null) => {
      if (!node) return false;
      const s = getComputedStyle(node);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow.split(/,(?![^(]*\))/).some((layer) => {
        const l = layer.trim();
        return l !== "none" && !l.startsWith("rgba(0, 0, 0, 0)") && !/ 0px 0px 0px 0px/.test(l);
      });
      return outline || ring;
    };
    return visible(el) || visible(el.closest("label"));
  });
  expect(shown).toBe(true);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("an administrator sets up the organisation from first sign-in to a finished setup", async ({
  browser,
}) => {
  // A fresh sign-in, so the role change below counts as a recent sign-in (P2-R5).
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await submitKeycloakForm(page, ADMIN_EMAIL);
  await expect(page).toHaveURL(`${WEB_URL}/`);
  await waitForShell(page);

  await page.getByRole("link", { name: "Set up your organisation" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/setup/organisation`);
  await page.getByLabel("Organisation name").fill("Amber Coast Components SIA");
  await page
    .getByLabel("What does your organisation do?")
    .fill("We make electronic components for industrial machines.");
  await page.getByLabel("Roughly how many people work here?").fill("850");
  await saveAndContinue(page);

  await expect(page).toHaveURL(`${WEB_URL}/setup/sites`);
  const siteNames = page.getByRole("textbox", { name: "Site name" });
  const countries = page.getByRole("combobox", { name: "Country" });
  await siteNames.nth(0).fill("Riga plant");
  await countries.nth(0).selectOption({ label: "Latvia" });
  await page.getByRole("button", { name: "Add a site" }).click();
  await siteNames.nth(1).fill("Munich office");
  await countries.nth(1).selectOption({ label: "Germany" });
  await page.getByRole("button", { name: "Add a department" }).click();
  await page.getByRole("textbox", { name: "Department name" }).fill("Production");
  await saveAndContinue(page);

  await expect(page).toHaveURL(`${WEB_URL}/setup/frameworks`);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^GDPR/ }).check();
  await page.getByRole("checkbox", { name: /^ISO\/IEC 27001/ }).check();
  await saveAndContinue(page);

  await expect(page).toHaveURL(`${WEB_URL}/setup/risk-appetite`);
  await expect(page.getByRole("radio", { name: "Balanced" })).toBeChecked();
  await saveAndContinue(page);

  await expect(page).toHaveURL(`${WEB_URL}/setup/people`);
  const carl = page.getByRole("listitem").filter({ hasText: "Carl Ciso" });
  await page.getByRole("button", { name: "Change roles for Carl Ciso" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Where do these roles apply?" })).toHaveValue(
    "organisation",
  );
  await dialog.getByRole("checkbox", { name: "Security lead" }).check();
  await dialog.getByRole("button", { name: "Save roles" }).click();
  await expect(dialog).toBeHidden();
  await expect(carl.getByText("Security lead")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Roles saved for Carl Ciso." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();

  await expect(page).toHaveURL(`${WEB_URL}/setup/review`);
  const main = page.getByRole("main");
  for (const text of [
    "Amber Coast Components SIA",
    "About 850 people",
    "Riga plant",
    "Munich office",
    "Production",
    "GDPR Regulation (EU) 2016/679",
    "ISO/IEC 27001 2022",
    "Balanced. Above appetite when a risk scores more than 9.",
  ]) {
    await expect(main.getByText(text, { exact: false }).first()).toBeVisible();
  }
  // Finishing goes to /?setup=done; Home then drops the flag from the address bar.
  const home = page.waitForRequest((r) => new URL(r.url()).searchParams.get("setup") === "done");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await home;
  await expect(
    page.getByRole("status").filter({ hasText: "Your organisation is set up." }),
  ).toBeVisible();
  // The flag leaves the URL once announced, so a reload does not announce it again.
  await expect(page).toHaveURL(`${WEB_URL}/`);

  // Reviewing a finished setup says so, with no Finish, and every step stays editable.
  await page.getByRole("link", { name: "Review setup" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/setup/review`);
  await expect(
    page.getByText(/^Setup was finished on .+\. You can still change any answer/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish setup" })).toHaveCount(0);
  await expect(page.getByText("You can finish setup now.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit Where you work" })).toHaveAttribute(
    "href",
    "/setup/sites",
  );

  expect(await auditActions()).toEqual(
    expect.arrayContaining([
      "organisation.profile_updated",
      "organisation.site_added",
      "organisation.framework_confirmed",
      "organisation.risk_scale_created",
      "identity.role_granted",
      "organisation.setup_completed",
    ]),
  );
  await context.close();
});

test("people who cannot manage the organisation get a plain 'no access' page at /setup", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: REPORTER_STATE });
  const page = await context.newPage();
  for (const path of ["/setup", "/setup/people"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This part of the workspace isn't open to you",
    );
    await expect(page.getByRole("link", { name: "Organisation" })).toHaveCount(0);
  }
  await context.close();
});

test("the setup steps are usable with the keyboard alone, with visible focus", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();

  await page.goto("/setup/frameworks");
  await waitForShell(page);
  const nis2 = page.getByRole("checkbox", { name: /^NIS2/ });
  await tabTo(page, nis2);
  await expectVisibleFocus(page);
  await page.keyboard.press("Space");
  await expect(nis2).toBeChecked();
  await page.keyboard.press("Space");
  await expect(nis2).not.toBeChecked();

  await page.goto("/setup/risk-appetite");
  await waitForShell(page);
  const balanced = page.getByRole("radio", { name: "Balanced" });
  await tabTo(page, balanced);
  await expectVisibleFocus(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Bold" })).toBeChecked();
  // The preview follows the choice: at Bold (14), likelihood 3 × impact 4 = 12 is within.
  await expect(
    page.getByRole("table").locator("tbody td", { hasText: "12" }).first(),
  ).toContainText("Within appetite");
  await tabTo(page, page.getByRole("region", { name: "Risk appetite for every score" }));
  await expectVisibleFocus(page);

  await page.goto("/setup/people");
  await waitForShell(page);
  const change = page.getByRole("button", { name: "Change roles for Carl Ciso" });
  await tabTo(page, change);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(change).toBeFocused();

  await page.goto("/setup/review");
  await waitForShell(page);
  const edit = page.getByRole("link", { name: "Edit Frameworks you follow" });
  await tabTo(page, edit);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${WEB_URL}/setup/frameworks`);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no violations on every setup step in ${theme}`, async ({ browser }) => {
    // Reduced motion pins the entrance to its end state, so axe never sees a half-faded page.
    const context = await browser.newContext({
      storageState: ADMIN_STATE,
      reducedMotion: "reduce",
    });
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    const page = await context.newPage();
    for (const path of STEPS) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("#setup-step-title")).toBeVisible();
      await expectNoAxeViolations(page);
    }
    // The role dialog, open over the people step.
    await page.goto("/setup/people");
    await waitForShell(page);
    await page.getByRole("button", { name: "Change roles for Carl Ciso" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoAxeViolations(page);
    await context.close();
  });
}
