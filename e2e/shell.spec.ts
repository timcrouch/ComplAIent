import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE, THEME_COOKIE, WEB_URL } from "./env";
import { greeting, waitForShell } from "./support";

// Signed in as reporter@example.test (storage state from auth.setup.ts).

const EMPTY_TITLE = "Your security workspace is ready.";
const EMPTY_BODY =
  "Once your organisation is set up, this is where you'll see how secure you are and what needs your attention.";

async function setTheme(page: Page, theme: "light" | "dark" | "system"): Promise<void> {
  await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
}

/**
 * Runs in the page on the focused element: does it match :focus-visible, and do its outline
 * or box-shadow differ from its resting (unfocused) style? A resting shadow alone does not
 * count. Transitions are allowed to finish before each reading. Focus is restored afterwards.
 */
async function focusIndicator(): Promise<{
  name: string;
  focusVisible: boolean;
  changed: boolean;
} | null> {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const settle = async () => {
    el.getBoundingClientRect(); // flush styles, so any transition starts now
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
  };
  // Only what can be seen: an outline with a style and width, and non-transparent shadow
  // layers (Tailwind's ring utilities leave transparent zero-size layers behind).
  const read = () => {
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
        ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`
        : "";
    const shadows = s.boxShadow === "none" ? [] : s.boxShadow.split(/,(?![^(]*\))/);
    const visible = shadows.map((l) => l.trim()).filter((l) => !l.startsWith("rgba(0, 0, 0, 0)"));
    return `${outline} | ${visible.join(", ")}`;
  };
  await settle();
  const focusedStyle = read();
  const focusVisible = el.matches(":focus-visible");
  el.blur();
  await settle();
  const restingStyle = read();
  el.focus();
  await settle();
  const name = (el.getAttribute("aria-label") ?? el.textContent).trim();
  return { name, focusVisible, changed: focusedStyle !== restingStyle };
}

const htmlTheme = (page: Page) => page.locator("html").getAttribute("data-theme");

test.describe("home", () => {
  test("greets by time of day in the user's time zone and first name", async ({ page }) => {
    await page.goto("/");
    await page.reload(); // the time-zone cookie is set by the first page load
    const cookies = await page.context().cookies(WEB_URL);
    expect(cookies.find((c) => c.name === "isms_tz")?.value).toBe("Europe%2FRiga");

    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: "Europe/Riga",
      }).format(new Date()),
    );
    const period =
      hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(`Good ${period}, Rita.`);
  });

  test("home empty state shows the designed copy and no numbers", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: EMPTY_TITLE })).toBeVisible();
    await expect(main.getByText(EMPTY_BODY)).toBeVisible();
    const text = await main.innerText();
    expect(text).not.toMatch(/\d+%|\d+ (risks|controls)/);
    expect(text).not.toMatch(/\d/);
    await expect(main.getByText("An administrator will set up your organisation.")).toBeVisible();
  });

  test("administrators see a link to set up the organisation", async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/, Anna\.$/);
    await expect(page.getByRole("main").getByText(/next update|coming soon/i)).toHaveCount(0);
    const setup = page.getByRole("link", { name: "Set up your organisation" });
    await expect(setup).toHaveAttribute("href", "/setup");

    // After the entrance fades: axe would measure the link's contrast mid-fade otherwise.
    await waitForShell(page);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(results.violations).toEqual([]);

    // /setup resumes at the first unanswered step: on a fresh installation, the first one.
    await setup.click();
    await expect(page).toHaveURL(`${WEB_URL}/setup/organisation`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About your organisation");
    await context.close();
  });

  test("the heading uses Plus Jakarta Sans", async ({ page }) => {
    await page.goto("/");
    const family = await page
      .getByRole("heading", { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/Plus Jakarta Sans/);
  });
});

test.describe("shell", () => {
  test("a slow primary navigation acknowledges the click and ignores a duplicate", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();
    let reportRequests = 0;
    await page.route("**/report?*", async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("_rsc")) return route.continue();
      reportRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });

    await page.goto("/");
    await waitForShell(page);
    const report = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Report a concern" });

    await report.evaluate((link) => (link as HTMLElement).click());
    await expect(report).toHaveAttribute("aria-busy", "true", { timeout: 100 });
    const requestsAfterFirstClick = reportRequests;
    await report.evaluate((link) => (link as HTMLElement).click());
    await page.waitForTimeout(150);
    expect(reportRequests).toBe(requestsAfterFirstClick);

    await expect(page).toHaveURL(`${WEB_URL}/report`);
    await expect(report).not.toHaveAttribute("aria-busy", "true");
    await context.close();
  });

  test("Ctrl+K opens palette and 'Switch theme' toggles data-theme", async ({ page }) => {
    await setTheme(page, "light");
    await page.goto("/");
    await waitForShell(page);
    expect(await htmlTheme(page)).toBe("light");

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("option")).toHaveText([
      "Go to Home",
      "Switch theme",
      "Sign out",
    ]);
    await page.getByRole("option", { name: "Switch theme" }).click();
    await expect(palette).toBeHidden();
    expect(await htmlTheme(page)).toBe("dark");

    // Stored in a cookie and rendered by the server: no flash on the next load.
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);

    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command palette" }).fill("home");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${WEB_URL}/`);
  });

  test("theme toggle offers light, dark and system", async ({ page }) => {
    await setTheme(page, "system");
    await page.goto("/");
    await waitForShell(page);
    expect(await htmlTheme(page)).toBeNull();
    await page.getByRole("button", { name: "Account menu" }).click();
    const group = page.getByRole("radiogroup", { name: "Theme" });
    await group.getByText("Dark", { exact: true }).click();
    await expect(group.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(await htmlTheme(page)).toBe("dark");
    await group.getByText("System", { exact: true }).click();
    await expect(group.getByRole("radio", { name: "System" })).toBeChecked();
    expect(await htmlTheme(page)).toBeNull();
  });

  test("user menu shows the user and a POST sign-out form", async ({ page }) => {
    await page.goto("/");
    await waitForShell(page);
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("dialog", { name: "Account" });
    await expect(menu.getByText("Rita Reporter")).toBeVisible();
    await expect(menu.getByText("reporter@example.test")).toBeVisible();
    const form = page.locator("form#sign-out-form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "/auth/logout");
    await expect(page.getByRole("link", { name: /sign out/i })).toHaveCount(0);
  });

  test("the view-mode choice is saved and survives a reload", async ({ page }) => {
    const modes = ["Guided", "Professional", "Executive"];
    const failure = page.getByText("We couldn't save your view. Please try again.");
    const group = () => page.getByRole("radiogroup", { name: "View mode" });
    const openMenu = async () => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(group().getByRole("radio")).toHaveCount(3);
    };
    const checkedMode = async () => {
      for (const name of modes) {
        if (await group().getByRole("radio", { name }).isChecked()) return name;
      }
      throw new Error("no view mode is checked");
    };
    // Picks a mode and waits for the server action that saves it to answer.
    const choose = async (name: string) => {
      const saved = page.waitForResponse(
        (res) => res.request().method() === "POST" && "next-action" in res.request().headers(),
      );
      await group().getByText(name, { exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await expect(group().getByRole("radio", { name })).toBeChecked();
      await expect(failure).toHaveCount(0);
    };

    await page.goto("/");
    await waitForShell(page);
    await openMenu();
    const original = await checkedMode();
    const changed = modes.find((name) => name !== original) ?? "Guided";

    await choose(changed);
    await page.reload();
    await waitForShell(page);
    await openMenu();
    await expect(group().getByRole("radio", { name: changed })).toBeChecked();

    // Leave the dev user as found, so every run starts from the same state.
    await choose(original);
    await page.reload();
    await waitForShell(page);
    await openMenu();
    await expect(group().getByRole("radio", { name: original })).toBeChecked();
  });
});

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: no violations on home in ${theme}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
      expect(await htmlTheme(page)).toBe(theme);
      await page.waitForFunction(() => document.getAnimations().length === 0);
      const axe = () =>
        new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
      expect((await axe()).violations).toEqual([]);

      // The glass account popover, over the page.
      await waitForShell(page);
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().length === 0);
      expect((await axe()).violations).toEqual([]);
    });
  }

  test("keyboard only: Tab reaches nav, palette, user menu with visible focus", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
    await waitForShell(page);
    const wanted = ["Skip to content", "Home", "Account menu", "Search"];
    const reached: string[] = [];
    for (let i = 0; i < 12 && reached.length < wanted.length; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(focusIndicator);
      if (!focused) continue;
      const match = wanted.find((w) => focused.name.startsWith(w));
      if (match && !reached.includes(match)) {
        expect(focused.focusVisible, `${match} matches :focus-visible`).toBe(true);
        expect(focused.changed, `${match} looks different when keyboard-focused`).toBe(true);
        reached.push(match);
      }
    }
    expect(reached).toEqual(wanted);

    // Search is focused: Enter opens the palette, Escape closes it.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();

    // Back to the account menu: open it from the keyboard, close with Escape.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Account" })).toBeHidden();
  });

  test("reduced motion: content is shown without animation", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    // Not vacuous: the server HTML really starts the entrance hidden and lowered.
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/data-entrance="" style="opacity:0;transform:translateY\(10px\)"/);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
    const samples = await page.evaluate(async () => {
      const out: { opacity: string; transform: string; animations: number }[] = [];
      for (let i = 0; i < 10; i++) {
        for (const el of document.querySelectorAll<HTMLElement>("[data-entrance]")) {
          const s = getComputedStyle(el);
          out.push({
            opacity: s.opacity,
            transform: s.transform,
            animations: el.getAnimations().length,
          });
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s).toEqual({ opacity: "1", transform: "none", animations: 0 });
    await context.close();
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("primary navigation becomes a bottom bar", async ({ page }) => {
    await page.goto("/");
    await waitForShell(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y + box.height).toBeGreaterThan(844 - 4);
      expect(box.width).toBeGreaterThan(380);
    }
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Account menu" }).tap();
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
  });

  test("the bottom bar never covers the end of the page", async ({ page }) => {
    await page.goto("/");
    await waitForShell(page);
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
    const last = await page.getByRole("main").getByRole("listitem").last().boundingBox();
    expect(nav && last).toBeTruthy();
    if (nav && last) expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  });
});
