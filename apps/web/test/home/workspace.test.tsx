// @vitest-environment jsdom
import type { WorkspaceResponse } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeView } from "../../components/home/home-view";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { EMPTY_WORKSPACE, WORKSPACE } from "./fixtures";

const base = { greeting: "Good morning, Carl.", setupDone: true, justFinished: false };

function renderHome(workspace: WorkspaceResponse = WORKSPACE, canSetUp = false) {
  return withMessages(<HomeView {...base} canSetUp={canSetUp} workspace={workspace} />);
}

const needs = () => screen.getByRole("list", { name: "What needs you" });

describe("home workspace", () => {
  it("shows only statements with a count, as plain sentences with plurals", () => {
    const { unmount } = renderHome();
    const links = within(needs()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "2 decisions need your approval",
      "5 risks are above your appetite",
      "4 evidence items are missing",
      "3 tasks are waiting for you",
      "Your concern was reviewed",
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      WORKSPACE.statements.map((s) => s.href),
    );
    unmount();

    renderHome({
      ...WORKSPACE,
      statements: [
        { key: "toReview", count: 1, href: "/risks?filter=toReview" },
        { key: "aboveAppetite", count: 1, href: "/risks?filter=aboveAppetite" },
        { key: "evidenceMissing", count: 1, href: "/risks?filter=evidenceMissing" },
        { key: "tasksOpen", count: 1, href: "/tasks" },
        { key: "concernsUpdated", count: 3, href: "/concerns" },
      ],
    });
    expect(
      within(needs())
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "1 risk is waiting for your review",
      "1 risk is above your appetite",
      "1 evidence item is missing",
      "1 task is waiting for you",
      "3 of your concerns were reviewed",
    ]);
  });

  it("shows the above-appetite statement in red and leaves the others alone", () => {
    renderHome();
    const links = within(needs()).getAllByRole("link");
    const above = links.find((l) => l.getAttribute("href") === "/risks?filter=aboveAppetite");
    expect(above?.innerHTML).toContain("text-critical");
    expect(above?.innerHTML).not.toContain("attention");
    const other = links.find((l) => l.getAttribute("href") === "/tasks");
    expect(other?.innerHTML).not.toContain("text-critical");
  });

  it("says plainly when nothing needs the viewer, without a list", () => {
    renderHome({ ...WORKSPACE, statements: [] });
    expect(screen.queryByRole("list", { name: "What needs you" })).toBeNull();
    expect(screen.getByText(en.home.statements.none)).toBeTruthy();
  });

  it("never renders a number that is not in the response", () => {
    renderHome();
    const main = document.body;
    // The greeting is computed on the server from the name and time of day, not from records.
    const greeting = screen.getByRole("heading", { level: 1 }).textContent;
    const labels = [...main.querySelectorAll("[aria-label]")].map((el) =>
      el.getAttribute("aria-label"),
    );
    const shown = [main.textContent.replace(greeting, ""), ...labels].join(" ");
    // Ids are not records' numbers; dates are compared by their parts (2026-12-01 → 1, 12, 2026).
    const data = JSON.stringify(WORKSPACE, (k, v: unknown) => (k === "id" ? undefined : v));
    const allowed = new Set((data.match(/\d+/g) ?? []).map(Number));
    const numbers = (shown.match(/\d+/g) ?? []).map(Number);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((n) => !allowed.has(n))).toEqual([]);
    expect(shown).not.toMatch(/%|score/i);
  });

  it("shows four dimensions, each a count, a bar with a text alternative and a sentence", () => {
    renderHome();
    const section = screen.getByRole("region", { name: en.home.dimensions.title });
    const items = within(section).getAllByRole("listitem");
    expect(items.map((i) => within(i).getByRole("heading").textContent)).toEqual([
      "Controls",
      "Evidence",
      "Risks",
      "Tasks",
    ]);
    const sentences = [
      "12 of 15 accepted controls have evidence",
      "4 of 17 risks are missing evidence",
      "5 of 17 risks are above your appetite",
      "8 of 9 open tasks are overdue",
    ];
    items.forEach((item, i) => {
      const bar = within(item).getByRole("img");
      expect(bar.textContent).toBe("");
      expect(bar.getAttribute("aria-label")).toBe(sentences[i]);
      expect(within(item).getByText(sentences[i] as string)).toBeTruthy();
    });
    expect(items.map((i) => i.querySelector("[data-count]")?.textContent)).toEqual([
      "15",
      "23",
      "17",
      "9",
    ]);
  });

  it("explains an empty dimension in words and draws an empty bar", () => {
    renderHome({
      ...WORKSPACE,
      dimensions: {
        risks: {
          total: 2,
          aboveAppetite: 0,
          proposed: 2,
          inReview: 0,
          approved: 0,
          returned: 0,
          closed: 0,
        },
        controls: { accepted: 0, withEvidence: 0, testedWithinInterval: 0 },
        evidence: { items: 0, missing: 0 },
        tasks: { open: 0, overdue: 0 },
      },
    });
    const section = screen.getByRole("region", { name: en.home.dimensions.title });
    expect(within(section).getByText("No accepted controls yet")).toBeTruthy();
    expect(within(section).getByText("No open tasks")).toBeTruthy();
    expect(within(section).getByText("0 of 2 risks are above your appetite")).toBeTruthy();
  });

  it("has no dimensions for someone who cannot read risks", () => {
    renderHome({ ...WORKSPACE, dimensions: null });
    expect(screen.queryByRole("region", { name: en.home.dimensions.title })).toBeNull();
  });

  it("lists the viewer's concerns and tasks, with links to all of them", () => {
    renderHome();
    const concerns = screen.getByRole("region", { name: en.home.concerns.title });
    expect(within(concerns).getByText("R-0042")).toBeTruthy();
    expect(within(concerns).getByText("Laptop left on the train")).toBeTruthy();
    expect(within(concerns).getByText(en.concerns.status.in_review)).toBeTruthy();
    expect(
      within(concerns).getByRole("link", { name: en.home.concerns.all }).getAttribute("href"),
    ).toBe("/concerns");

    const tasks = screen.getByRole("region", { name: en.home.tasks.title });
    const rows = within(tasks).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Upload the restore report");
    expect(rows[0]?.textContent).toContain("Due 1 December 2026");
    expect(rows[0]?.textContent).not.toContain("Overdue");
    expect(rows[1]?.textContent).toContain("Overdue");
    expect(within(tasks).getByRole("link", { name: en.home.tasks.all }).getAttribute("href")).toBe(
      "/tasks",
    );
  });

  it("names a periodic review on the home list as the task list does", () => {
    const review = {
      id: "8b3c4d5e-6f7a-4b80-8c92-d3e4f5a6b7c8",
      kind: "periodic_review" as const,
      title: "Review this risk",
      riskReference: "R-0007",
      riskTitle: "Server room floods",
      riskId: null,
      dueDate: null,
      overdue: false,
    };
    renderHome({ ...WORKSPACE, myTasks: [review] });
    const tasks = screen.getByRole("region", { name: en.home.tasks.title });
    expect(within(tasks).getByText("Review R-0007: Server room floods")).toBeTruthy();
  });

  it("shows the designed empty state only when there is nothing at all", () => {
    const { unmount } = renderHome(EMPTY_WORKSPACE);
    expect(screen.getByRole("heading", { name: en.home.empty.title })).toBeTruthy();
    expect(screen.queryByRole("region", { name: en.home.dimensions.title })).toBeNull();
    unmount();

    const zero = {
      risks: {
        total: 0,
        aboveAppetite: 0,
        proposed: 0,
        inReview: 0,
        approved: 0,
        returned: 0,
        closed: 0,
      },
      controls: { accepted: 0, withEvidence: 0, testedWithinInterval: 0 },
      evidence: { items: 0, missing: 0 },
      tasks: { open: 0, overdue: 0 },
    };
    const second = renderHome({ ...EMPTY_WORKSPACE, dimensions: zero });
    expect(screen.getByRole("heading", { name: en.home.empty.title })).toBeTruthy();
    second.unmount();

    const [concern] = WORKSPACE.myConcerns;
    renderHome({ ...EMPTY_WORKSPACE, dimensions: zero, myConcerns: concern ? [concern] : [] });
    expect(screen.queryByRole("heading", { name: en.home.empty.title })).toBeNull();
    expect(screen.getByRole("region", { name: en.home.concerns.title })).toBeTruthy();
  });

  it("leaves Report a concern to the app header, which shows it on every page", () => {
    renderHome();
    expect(screen.queryByRole("link", { name: "Report a concern" })).toBeNull();
  });

  it("keeps the setup hint for an administrator while setup is unfinished", () => {
    withMessages(<HomeView {...base} setupDone={false} canSetUp workspace={WORKSPACE} />);
    expect(screen.getByRole("link", { name: en.home.hint.setupAction }).getAttribute("href")).toBe(
      "/setup",
    );
  });
});
