// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MyConcernsResponse, Permission } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConcernList } from "../../components/report/concern-list";
import { AppShell } from "../../components/shell/app-shell";
import { navItemsFor } from "../../components/shell/nav-items";
import en from "../../messages/index";
import { withMessages } from "../intl";

const push = vi.fn();
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => pathname,
}));
vi.mock("../../lib/actions/view-mode", () => ({ saveViewMode: vi.fn() }));

const REPORTER: Permission[] = ["me.read", "risks.report"];

function shell(permissions: Permission[] = REPORTER) {
  return withMessages(
    <AppShell
      user={{ displayName: "Rita Reporter", email: "reporter@example.test" }}
      viewMode="guided"
      theme="light"
      permissions={permissions}
    >
      <p>page</p>
    </AppShell>,
  );
}

beforeEach(() => {
  push.mockReset();
  pathname = "/";
});

describe("Report a concern in the shell", () => {
  it("is in navigation for people who may report", () => {
    expect(navItemsFor(["me.read"]).map((i) => i.key)).toEqual(["home"]);
    expect(navItemsFor(REPORTER).map((i) => [i.key, i.href])).toEqual([
      ["home", "/"],
      ["report", "/report"],
      ["tasks", "/tasks"],
    ]);
  });

  it("has a header button, a ⌘K command and the Ctrl+Shift+R shortcut", async () => {
    shell();
    const banner = screen.getByRole("banner");
    expect(
      within(banner)
        .getByRole("link", { name: /Report a concern/ })
        .getAttribute("href"),
    ).toBe("/report");

    fireEvent.keyDown(document, { key: "R", ctrlKey: true, shiftKey: true });
    expect(push).toHaveBeenCalledWith("/report");

    push.mockReset();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: en.palette.report }));
    expect(push).toHaveBeenCalledWith("/report");
  });

  it("leaves a half-filled report alone: the shortcut does nothing on /report", () => {
    pathname = "/report";
    shell();
    fireEvent.keyDown(document, { key: "R", ctrlKey: true, shiftKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("offers none of it to people who may not report", () => {
    shell(["me.read"]);
    expect(screen.queryByRole("link", { name: /Report a concern/ })).toBeNull();
    fireEvent.keyDown(document, { key: "R", ctrlKey: true, shiftKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ConcernList", () => {
  const items: MyConcernsResponse["items"] = [
    ["proposed", "R-0004"],
    ["in_review", "R-0003"],
    ["approved", "R-0002"],
    ["returned", "R-0001"],
  ].map(([state, reference], i) => ({
    id: `00000000-0000-4000-8000-00000000000${String(i)}`,
    reference: reference ?? "",
    title: `Concern ${String(i)}`,
    state: state as MyConcernsResponse["items"][number]["state"],
    updatedAt: "2026-11-05T09:30:00.000Z",
  }));

  it("lists each concern with its status in plain words and an icon", () => {
    withMessages(<ConcernList items={items} timeZone="Europe/Riga" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    const words = Object.values(en.concerns.status);
    rows.forEach((row, i) => {
      expect(row.textContent).toContain(words[i]);
      expect(row.querySelector("[data-concern-status] svg")).not.toBeNull();
      expect(row.textContent).toContain("5 November 2026");
    });
    expect(rows[0]?.textContent).toContain("R-0004");
  });

  it("invites a first report when there are none", () => {
    withMessages(<ConcernList items={[]} timeZone="Europe/Riga" />);
    expect(screen.getByText(en.concerns.empty)).toBeTruthy();
    expect(screen.getByRole("link", { name: en.concerns.reportFirst }).getAttribute("href")).toBe(
      "/report",
    );
  });
});
