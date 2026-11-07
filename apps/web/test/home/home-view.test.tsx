// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeView } from "../../components/home/home-view";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { EMPTY_WORKSPACE } from "./fixtures";

const props = {
  greeting: "Good morning, Rita.",
  setupDone: false,
  justFinished: false,
  workspace: EMPTY_WORKSPACE,
};

describe("HomeView", () => {
  it("shows the greeting and the empty state, with no numbers", () => {
    withMessages(<HomeView {...props} canSetUp={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, Rita.");
    expect(screen.getByRole("heading", { name: en.home.empty.title })).toBeTruthy();
    expect(screen.getByText(en.home.empty.body)).toBeTruthy();
    expect(screen.getByText(en.home.hint.member)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d/);
  });

  it("administrators get a working link to set up the organisation", () => {
    withMessages(<HomeView {...props} canSetUp />);
    const link = screen.getByRole("link", { name: en.home.hint.setupAction });
    expect(link.getAttribute("href")).toBe("/setup");
    expect(link.hasAttribute("aria-disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: en.home.hint.setupAction })).toBeNull();
    expect(screen.queryByText(en.home.hint.member)).toBeNull();
    expect(document.body.textContent).not.toMatch(/next update|coming soon/i);
  });

  it("after setup, administrators can review it and members are told it is set up", () => {
    const { unmount } = withMessages(<HomeView {...props} setupDone canSetUp />);
    expect(screen.getByText(en.home.hint.adminDone)).toBeTruthy();
    const review = screen.getByRole("link", { name: en.home.hint.reviewSetup });
    expect(review.getAttribute("href")).toBe("/setup/review");
    expect(screen.queryByRole("link", { name: en.home.hint.setupAction })).toBeNull();
    expect(screen.getByText(en.home.empty.bodyDone)).toBeTruthy();
    unmount();

    withMessages(<HomeView {...props} setupDone canSetUp={false} />);
    expect(screen.getByText(en.home.hint.memberDone)).toBeTruthy();
    expect(screen.queryByText(en.home.hint.member)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("announces a finished setup in a status region", async () => {
    window.history.replaceState(null, "", "/?setup=done");
    withMessages(<HomeView {...props} setupDone justFinished canSetUp />);
    const status = screen.getByRole("status");
    await waitFor(() => {
      expect(status.textContent).toBe(en.home.setupDone);
    });
    // Announced once: the flag leaves the URL, so a reload does not announce it again.
    expect(window.location.search).toBe("");
  });
});

describe("HomeView At a glance", () => {
  const tiles = [
    { key: "openRisks", value: 17, change: null },
    { key: "aboveAppetite", value: 5, change: null },
    { key: "reported", value: 8, change: null },
    { key: "approved", value: 6, change: null },
    { key: "closed", value: 2, change: null },
    { key: "overdueActions", value: 4, change: null },
    { key: "reviewsDue", value: 3, change: null },
  ] as const;

  it("shows the tiles and a link to the board pack when tiles are given", () => {
    const period = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
    withMessages(<HomeView {...props} canSetUp={false} glance={{ tiles: [...tiles], period }} />);
    const region = screen.getByRole("region", { name: en.reports.glance.title });
    expect(region.textContent).toContain("Where things stand for October 2026");
    expect(region.textContent).toContain("Open risks");
    expect(region.textContent).toContain("17");
    expect(region.textContent).toContain("Above appetite");
    expect(screen.getByRole("link", { name: en.reports.glance.link }).getAttribute("href")).toBe(
      "/reports/board",
    );
  });

  it("shows nothing without facts", () => {
    withMessages(<HomeView {...props} canSetUp={false} />);
    expect(screen.queryByRole("region", { name: en.reports.glance.title })).toBeNull();
  });
});
