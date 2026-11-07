// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Permission } from "@isms/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/shell/app-shell";
import { navItemsFor } from "../components/shell/nav-items";
import en from "../messages/index";
import { MARK, marked, withMessages } from "./intl";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/",
}));
const saveViewMode = vi.fn();
vi.mock("../lib/actions/view-mode", () => ({
  saveViewMode: (...args: unknown[]) => saveViewMode(...args) as unknown,
}));

const saveTheme = vi.fn();
vi.mock("../lib/actions/theme", () => ({
  saveTheme: (...args: unknown[]) => saveTheme(...args) as unknown,
}));

const user = { displayName: "Rita Reporter", email: "reporter@example.test" };

function shell(messages?: unknown, permissions: Permission[] = ["me.read"]) {
  return withMessages(
    <AppShell user={user} viewMode="guided" theme="light" permissions={permissions}>
      <p>page</p>
    </AppShell>,
    messages,
  );
}

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  document.cookie = "isms_theme=; max-age=0; path=/";
  push.mockReset();
  refresh.mockReset();
  saveViewMode.mockReset().mockResolvedValue({ ok: true, data: { viewMode: "executive" } });
  saveTheme
    .mockReset()
    .mockResolvedValue({ ok: true, data: { viewMode: "guided", theme: "dark" } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("has a skip link, primary navigation with Home, a search button and the page", () => {
    shell();
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(
      "#main",
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const home = within(nav).getByRole("link", { name: "Home" });
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Search/ })).toBeTruthy();
    expect(screen.getByRole("main").textContent).toContain("page");
  });

  it("shows Organisation in navigation only to people who can manage it", () => {
    expect(navItemsFor(["me.read", "organisation.read"]).map((i) => i.key)).toEqual(["home"]);
    expect(navItemsFor(["organisation.manage"]).map((i) => [i.key, i.href])).toEqual([
      ["home", "/"],
      ["organisation", "/setup"],
    ]);
    shell(undefined, ["me.read", "organisation.read", "organisation.manage"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const link = within(nav).getByRole("link", { name: en.nav.organisation });
    expect(link.getAttribute("href")).toBe("/setup");
    expect(link.hasAttribute("aria-current")).toBe(false);
  });

  it("shows Controls in navigation only to people who can read the library", () => {
    expect(navItemsFor(["me.read"]).map((i) => i.key)).toEqual(["home"]);
    expect(
      navItemsFor(["library.read", "organisation.manage"]).map((i) => [i.key, i.href]),
    ).toEqual([
      ["home", "/"],
      ["library", "/library"],
      ["organisation", "/setup"],
    ]);
    shell(undefined, ["me.read", "library.read"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: en.nav.library }).getAttribute("href")).toBe(
      "/library",
    );
  });

  it("shows Settings in navigation only to people who manage the AI settings", () => {
    expect(navItemsFor(["library.read", "organisation.manage"]).map((i) => i.key)).not.toContain(
      "settings",
    );
    expect(navItemsFor(["organisation.manage", "settings.ai.manage"]).at(-1)).toMatchObject({
      key: "settings",
      href: "/settings/ai",
    });
    shell(undefined, ["me.read", "settings.ai.manage"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: en.nav.settings }).getAttribute("href")).toBe(
      "/settings/ai",
    );
  });

  it("offers 'Go to Controls' to people who can read the library", async () => {
    shell(undefined, ["me.read", "library.read"]);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: en.palette.goLibrary }));
    expect(push).toHaveBeenCalledWith("/library");
  });

  it("renders a POST sign-out form, never a link", () => {
    shell();
    const form = document.getElementById("sign-out-form") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/auth/logout");
    expect(screen.queryByRole("link", { name: /sign out/i })).toBeNull();
  });

  it("Ctrl+K opens the palette with Go to Home, Switch theme and Sign out", async () => {
    shell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Go to Home", "Switch theme", "Sign out"]);
  });

  it("offers 'Set up your organisation' to people who can manage it", async () => {
    shell(undefined, ["me.read", "organisation.manage"]);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: en.palette.setUp }));
    expect(push).toHaveBeenCalledWith("/setup");
  });

  it("'Go to Home' navigates to /", async () => {
    shell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: "Go to Home" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("'Switch theme' toggles data-theme and stores the choice in a cookie", async () => {
    shell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: "Switch theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("isms_theme=dark");
    expect(saveTheme).toHaveBeenCalledWith("dark");
  });

  it("'Sign out' submits the logout form", async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(function (this: HTMLFormElement) {
        expect(this.id).toBe("sign-out-form");
      });
    shell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await userEvent.click(await screen.findByRole("option", { name: "Sign out" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("the account menu shows the user, theme and view-mode choices and sign-out", async () => {
    shell();
    await userEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    const menu = await screen.findByRole("dialog", { name: "Account" });
    expect(within(menu).getByText("Rita Reporter")).toBeTruthy();
    expect(within(menu).getByText("reporter@example.test")).toBeTruthy();

    const theme = within(menu).getByRole("radiogroup", { name: "Theme" });
    expect(
      within(theme)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value")),
    ).toEqual(["light", "dark", "system"]);
    await userEvent.click(within(theme).getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.cookie).toContain("isms_theme=system");
    // Saved on the account, so it follows the user and not the browser (#2).
    expect(saveTheme).toHaveBeenCalledWith("system");

    const mode = within(menu).getByRole("radiogroup", { name: "View mode" });
    const radio = (name: string) => within(mode).getByRole<HTMLInputElement>("radio", { name });
    expect(radio("Guided").checked).toBe(true);
    await userEvent.click(radio("Executive"));
    expect(radio("Executive").checked).toBe(true);
    expect(mode.getAttribute("aria-describedby")).toBeTruthy();
    const description = document.getElementById(mode.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe(en.viewMode.aboutText);

    const signOut = within(menu).getByRole("button", { name: "Sign out" });
    expect(signOut.getAttribute("type")).toBe("submit");
    expect(signOut.getAttribute("form")).toBe("sign-out-form");
  });

  it("view-mode switch saves the choice and reverts with a message when saving fails", async () => {
    shell();
    await userEvent.click(screen.getByRole("button", { name: /Account menu/ }));
    const menu = await screen.findByRole("dialog", { name: "Account" });
    const mode = within(menu).getByRole("radiogroup", { name: "View mode" });
    const radio = (name: string) => within(mode).getByRole<HTMLInputElement>("radio", { name });

    await userEvent.click(radio("Executive"));
    expect(saveViewMode).toHaveBeenCalledWith("executive");
    expect(radio("Executive").checked).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.viewMode.saveFailed)).toBeNull();

    saveViewMode.mockResolvedValue({ ok: false, kind: "unavailable", details: [] });
    await userEvent.click(radio("Professional"));
    expect(saveViewMode).toHaveBeenLastCalledWith("professional");
    expect(radio("Executive").checked).toBe(true);
    expect(radio("Professional").checked).toBe(false);
    expect(within(menu).getByRole("status").textContent).toBe(en.viewMode.saveFailed);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("takes every visible string, including @isms/ui labels, from the message file", async () => {
    shell(marked(en));
    expect(screen.getByRole("link", { name: `Skip to content${MARK}` })).toBeTruthy();
    expect(screen.getByRole("link", { name: `Home${MARK}` })).toBeTruthy();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    expect(input.getAttribute("aria-label")).toBe(`Command palette${MARK}`);
    expect(input.getAttribute("placeholder")).toBe(`Search or jump to…${MARK}`);
    const dialog = screen.getByRole("dialog");
    for (const label of ["Navigate", "Select", "Close", "Esc"]) {
      expect(within(dialog).getByText(`${label}${MARK}`)).toBeTruthy();
    }
    expect(within(dialog).getByRole("status").textContent).toBe(`3 results${MARK}`);
    await act(async () => {
      await userEvent.type(input, "zzz");
    });
    expect(within(dialog).getByRole("status").textContent).toBe(`No matches${MARK}`);
  });
});
