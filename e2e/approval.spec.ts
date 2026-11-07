import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ADMIN_EMAIL,
  APPROVER_EMAIL,
  CISO_EMAIL,
  REPORTER_EMAIL,
  THEME_COOKIE,
  WEB_URL,
} from "./env";
import { api, apiToken, grantRoleViaApi, signIn, waitForShell } from "./support";

// Runs after review. Self-contained: it reports its own risks through the API. Carl Ciso
// reviews, Adam Approver approves, and Rita Reporter (a contributor who also holds the
// approver role here, for the separation-of-duties test) reports. Serial: tests share risks.
test.describe.configure({ mode: "serial", retries: 0 });

const FIXTURE = new URL("./fixtures/evidence.pdf", import.meta.url).pathname;
const FILE_NAME = "evidence.pdf";
const stamp = String(Date.now()).slice(-6);

type Detail = { id: string; version: number };
const risks = { evidence: "", own: "", high: "", returned: "" };
let controlCode = "";
let controlTitle = "";

async function sha256Of(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/**
 * Rita reports a risk; Carl completes it (score, treatment, himself as owner, one accepted
 * control) and, if asked, submits it. A score of 1 is within appetite, 25 above it.
 */
async function arrange(title: string, score: 1 | 25, submit: boolean): Promise<string> {
  const [rita, carl] = [await apiToken(REPORTER_EMAIL), await apiToken(CISO_EMAIL)];
  const org = (await api(carl, "GET", "/api/v1/organisation")).data as {
    sites: { id: string; name: string }[];
  };
  const siteId = org.sites.find((s) => s.name === "Riga plant")?.id ?? null;
  const carlId = ((await api(carl, "GET", "/api/v1/me")).data as { id: string }).id;
  let risk = (
    await api(rita, "POST", "/api/v1/risks", {
      title,
      scenario: "The nightly backup has not been restored for a year.",
      threat: "A disk failure",
      consequence: "Customer orders could be lost",
      existingSafeguards: "",
      assets: [],
      siteId,
      departmentId: null,
      toConfirm: [],
    })
  ).data as Detail;
  const level = score === 1 ? 1 : 5;
  risk = (
    await api(carl, "PATCH", `/api/v1/risks/${risk.id}`, {
      expectedVersion: risk.version,
      changes: { likelihood: level, impact: level, treatment: "mitigate", ownerId: carlId },
    })
  ).data as Detail;
  risk = (
    await api(carl, "POST", `/api/v1/risks/${risk.id}/controls`, {
      expectedVersion: risk.version,
      controlCode,
    })
  ).data as Detail;
  if (submit) {
    await api(carl, "POST", `/api/v1/risks/${risk.id}/submit`, {
      expectedVersion: risk.version,
    });
  }
  return risk.id;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  await grantRoleViaApi(REPORTER_EMAIL, "contributor");
  await grantRoleViaApi(REPORTER_EMAIL, "risk_approver");
  await grantRoleViaApi(APPROVER_EMAIL, "risk_approver");
  const library = (await api(await apiToken(ADMIN_EMAIL), "GET", "/api/v1/library/controls"))
    .data as { items: { code: string; title: string }[] };
  const first = library.items[0];
  if (!first) throw new Error("The control library is empty");
  ({ code: controlCode, title: controlTitle } = first);
  risks.evidence = await arrange(`Backups never restored ${stamp}`, 1, false);
  risks.own = await arrange(`Rita's own risk ${stamp}`, 1, true);
  risks.high = await arrange(`Payroll server unpatched ${stamp}`, 25, false);
  risks.returned = await arrange(`Shared admin password ${stamp}`, 1, true);
});

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const announcer = (page: Page) => page.getByTestId("risk-announcer");

async function openRisk(page: Page, id: string): Promise<void> {
  await page.goto(`/risks/${id}`);
  await waitForShell(page);
}

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

async function uploadFixture(dialog: Locator): Promise<void> {
  await dialog.getByLabel("File", { exact: true }).setInputFiles(FIXTURE);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("reviewer uploads evidence and the downloaded file's SHA-256 matches the one shown", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, CISO_EMAIL);
  await openRisk(page, risks.evidence);
  const evidence = region(page, "Evidence");
  await expect(evidence.getByText("No evidence yet.")).toBeVisible();
  const trigger = evidence.getByRole("button", { name: "Upload evidence" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Upload evidence" });
  await dialog.getByRole("checkbox", { name: new RegExp(controlCode) }).check();
  await dialog.getByLabel("Classification", { exact: true }).selectOption("confidential");
  await uploadFixture(dialog);
  await expect(announcer(page)).toHaveText(`${FILE_NAME} uploaded.`);
  await expect(trigger).toBeFocused();

  const item = evidence.getByRole("list", { name: "Evidence files" }).locator("> li");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Uploaded by Carl Ciso");
  await expect(item).toContainText(controlTitle);
  await expect(item).toContainText("Classification: Confidential");
  const shown = (await item.locator("code").textContent()) ?? "";
  expect(shown).toBe(await sha256Of(FIXTURE));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    item.getByRole("link", { name: `Download ${FILE_NAME}` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(FILE_NAME);
  expect(await download.failure()).toBeNull();
  expect(await sha256Of(await download.path())).toBe(shown);
  await context.close();
});

test("reviewer requests evidence from Rita, who uploads it from Tasks and the task completes", async ({
  browser,
}) => {
  const title = `Last restore report ${stamp}`;
  const carl = await signIn(browser, CISO_EMAIL);
  await openRisk(carl.page, risks.evidence);
  const evidence = region(carl.page, "Evidence");
  await evidence.getByRole("button", { name: "Request evidence" }).click();
  const dialog = carl.page.getByRole("dialog", { name: "Request evidence" });
  await dialog.getByLabel("Person", { exact: true }).selectOption({ label: "Rita Reporter" });
  await dialog
    .getByLabel("Control", { exact: true })
    .selectOption({ label: `${controlCode} ${controlTitle}` });
  await dialog.getByLabel("What you need", { exact: true }).fill(title);
  await dialog.getByLabel("Details", { exact: true }).fill("The report from the last restore.");
  await dialog.getByLabel("Due date", { exact: true }).fill("2026-12-01");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog).toBeHidden();
  await expect(announcer(carl.page)).toHaveText("Request sent to Rita Reporter.");
  await carl.context.close();

  const rita = await signIn(browser, REPORTER_EMAIL);
  await rita.page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Tasks" })
    .click();
  await expect(rita.page).toHaveURL(`${WEB_URL}/tasks`);
  await expect(rita.page).toHaveTitle("Tasks · ComplAIent ISMS");
  const task = rita.page
    .getByRole("list", { name: "Your tasks" })
    .getByRole("listitem")
    .filter({ hasText: title });
  await expect(task).toContainText(`For control ${controlCode} · ${controlTitle}`);
  await expect(task).toContainText("Open");
  await task.getByRole("button", { name: /Upload the file/ }).click();
  await uploadFixture(rita.page.getByRole("dialog"));
  await expect(rita.page.getByTestId("tasks-announcer")).toHaveText(`${title} is done.`);
  await expect(task).toContainText("Done");
  await expect(task.getByRole("button")).toHaveCount(0);
  await expect(task.getByRole("heading", { name: title })).toBeFocused();
  // Still done after a reload: the API completed it.
  await rita.page.reload();
  await expect(task).toContainText("Done");
  await rita.context.close();

  const detail = (await api(await apiToken(CISO_EMAIL), "GET", `/api/v1/risks/${risks.evidence}`))
    .data as { evidence: { uploadedBy: { displayName: string } }[] };
  expect(detail.evidence.map((e) => e.uploadedBy.displayName)).toEqual([
    "Rita Reporter",
    "Carl Ciso",
  ]);
});

test("the reporter cannot approve their own risk", async ({ browser }) => {
  const { context, page } = await signIn(browser, REPORTER_EMAIL);
  await openRisk(page, risks.own);
  const approval = region(page, "Approval");
  await expect(approval).toContainText("Waiting for approval.");
  await expect(
    approval.getByText("You reported this risk, so someone else must approve it."),
  ).toBeVisible();
  await expect(approval.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await context.close();
  // The API refuses it too: the page only says what the API decides.
  const rita = await apiToken(REPORTER_EMAIL);
  const risk = (await api(rita, "GET", `/api/v1/risks/${risks.own}`)).data as Detail;
  await api(
    rita,
    "POST",
    `/api/v1/risks/${risks.own}/approve`,
    { expectedVersion: risk.version },
    [409],
  );
});

test("the reviewer approves a within-appetite risk without holding the approver role", async ({
  browser,
}) => {
  // Carl is a CISO (risks.review) and never risk_approver: spec §8.3 lets him approve this one.
  const carl = await signIn(browser, CISO_EMAIL);
  await openRisk(carl.page, risks.own);
  const approval = region(carl.page, "Approval");
  await expect(approval).toContainText("Its reviewer or an approver may approve it.");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(announcer(carl.page)).toHaveText("Risk approved.");
  await expect(carl.page.getByTestId("risk-header")).toContainText("Approved");
  await expect(approval.getByRole("list", { name: "Approval decisions" })).toContainText(
    "Approved by Carl Ciso",
  );
  await carl.context.close();
});

test("an above-appetite risk needs Adam Approver; the reviewer is refused, Adam approves", async ({
  browser,
}) => {
  const carl = await signIn(browser, CISO_EMAIL);
  await openRisk(carl.page, risks.high);
  let approval = region(carl.page, "Approval");
  await approval.getByRole("button", { name: "Submit for approval" }).click();
  await expect(announcer(carl.page)).toHaveText("Submitted for approval.");
  await expect(approval.getByRole("heading", { name: "Approval" })).toBeFocused();
  await expect(carl.page.getByTestId("risk-header")).toContainText("In review");
  await expect(
    approval.getByText(
      "This risk is above your appetite or accepted, so someone other than its reviewer must approve it.",
    ),
  ).toBeVisible();
  await expect(approval.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await carl.context.close();

  const adam = await signIn(browser, APPROVER_EMAIL);
  await openRisk(adam.page, risks.high);
  approval = region(adam.page, "Approval");
  await approval.getByLabel("Comment", { exact: true }).fill("Patch within the week.");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(announcer(adam.page)).toHaveText("Risk approved.");
  await expect(adam.page.getByTestId("risk-header")).toContainText("Approved");
  const decisions = approval.getByRole("list", { name: "Approval decisions" });
  await expect(decisions).toContainText("Approved by Adam Approver");
  await expect(decisions).toContainText("Patch within the week.");
  await adam.context.close();
});

test("a returned risk can be edited and resubmitted", async ({ browser }) => {
  const adam = await signIn(browser, APPROVER_EMAIL);
  await openRisk(adam.page, risks.returned);
  let approval = region(adam.page, "Approval");
  await approval.getByRole("button", { name: "Return" }).click();
  const comment = approval.getByLabel("Comment", { exact: true });
  await expect(approval.getByText("Write why you're returning the risk.")).toBeVisible();
  await expect(comment).toBeFocused();
  await comment.fill("Name the systems that share the password.");
  await approval.getByRole("button", { name: "Return" }).click();
  await expect(announcer(adam.page)).toHaveText("Risk returned with your comment.");
  await expect(adam.page.getByTestId("risk-header")).toContainText("Returned");
  await adam.context.close();

  const carl = await signIn(browser, CISO_EMAIL);
  await openRisk(carl.page, risks.returned);
  approval = region(carl.page, "Approval");
  await expect(approval.getByRole("list", { name: "Approval decisions" })).toContainText(
    "Name the systems that share the password.",
  );
  const record = region(carl.page, "Record");
  await record.getByRole("button", { name: "Edit Title", exact: true }).click();
  await record
    .getByLabel("Title", { exact: true })
    .fill(`Shared admin password on three systems ${stamp}`);
  await record.getByRole("button", { name: "Save", exact: true }).click();
  await expect(record.getByRole("button", { name: "Edit Title", exact: true })).toBeFocused();
  await approval.getByRole("button", { name: "Submit for approval" }).click();
  await expect(announcer(carl.page)).toHaveText("Submitted for approval.");
  await expect(carl.page.getByTestId("risk-header")).toContainText("In review");
  await carl.context.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`evidence, tasks and approval pass axe in ${theme}`, async ({ browser }) => {
    const carl = await signIn(browser, CISO_EMAIL, { reducedMotion: "reduce" });
    await carl.context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    // Evidence listed; then the returned-and-resubmitted risk, which Carl may return.
    for (const id of [risks.evidence, risks.returned, risks.high]) {
      await carl.page.goto(`/risks/${id}`);
      await settle(carl.page);
      await expect(carl.page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoAxeViolations(carl.page);
    }
    await carl.page.goto(`/risks/${risks.evidence}`);
    await settle(carl.page);
    const evidence = region(carl.page, "Evidence");
    for (const name of ["Upload evidence", "Request evidence"]) {
      await evidence.getByRole("button", { name }).click();
      const dialog = carl.page.getByRole("dialog", { name });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^(Upload|Send request)$/ }).click();
      await expectNoAxeViolations(carl.page);
      await carl.page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(evidence.getByRole("button", { name })).toBeFocused();
    }
    await carl.context.close();

    const rita = await signIn(browser, REPORTER_EMAIL, { reducedMotion: "reduce" });
    await rita.context.addCookies([{ name: THEME_COOKIE, value: theme, url: WEB_URL }]);
    await rita.page.goto("/tasks");
    await settle(rita.page);
    await expectNoAxeViolations(rita.page);
    await rita.context.close();
  });
}
