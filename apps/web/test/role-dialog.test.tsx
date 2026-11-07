// @vitest-environment jsdom
import type { UserSummaryDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleList } from "../components/setup/people-list";
import en from "../messages/index";
import { withMessages } from "./intl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const grantRole = vi.fn();
const revokeRole = vi.fn();
vi.mock("../lib/actions/roles", () => ({
  grantRole: (...args: unknown[]) => grantRole(...args) as unknown,
  revokeRole: (...args: unknown[]) => revokeRole(...args) as unknown,
}));
const assign = vi.fn();
vi.mock("../lib/navigate", () => ({ goTo: (href: string) => assign(href) as unknown }));

const ANNA = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const CARL = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const RIGA = "7a2b3c4d-5e6f-4a70-9b81-c2d3e4f5a6b7";
const ADMIN_ROLE = "8b3c4d5e-6f70-4b81-8c92-d3e4f5a6b7c8";
const t = en.setup.people;
const r = en.roles;

const anna: UserSummaryDto = {
  id: ANNA,
  email: "admin@example.test",
  displayName: "Anna Admin",
  lastSeenAt: null,
  roles: [
    {
      id: ADMIN_ROLE,
      userId: ANNA,
      role: "administrator",
      scope: { type: "organisation", id: null },
      scopeName: null,
      createdAt: "2026-11-04T10:00:00.000Z",
    },
  ],
};
const carl: UserSummaryDto = {
  id: CARL,
  email: "ciso@example.test",
  displayName: "Carl Ciso",
  lastSeenAt: null,
  roles: [],
};

function people(users = [anna, carl]) {
  return withMessages(
    <PeopleList
      users={users}
      sites={[{ id: RIGA, name: "Riga plant", countryCode: "LV" }]}
      departments={[]}
    />,
  );
}

async function openFor(name: string) {
  await userEvent.click(screen.getByRole("button", { name: t.changeFor.replace("{name}", name) }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  grantRole.mockReset();
  revokeRole.mockReset();
  assign.mockReset();
});

describe("PeopleList", () => {
  it("lists signed-in people with role chips and says when people appear", () => {
    people();
    expect(screen.getByText(t.signInNote)).toBeTruthy();
    const list = screen.getByRole("list", { name: t.listLabel });
    // Each person's chips are a list of their own; only the people themselves count here.
    const items = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === list);
    expect(items[0]?.textContent).toContain("Anna Admin");
    expect(items[0]?.textContent).toContain(r.administrator.label);
    expect(items[0]?.textContent).toContain(t.wholeOrganisation);
    expect(items[1]?.textContent).toContain(t.noRoles);
  });
});

describe("RoleDialog", () => {
  it("lists roles with plain descriptions and requires a site when the scope is a site", async () => {
    people();
    const dialog = await openFor("Carl Ciso");
    for (const role of Object.values(r)) {
      const box = within(dialog).getByRole("checkbox", { name: role.label });
      const description = document.getElementById(box.getAttribute("aria-describedby") ?? "");
      expect(description?.textContent).toBe(role.description);
    }
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: t.dialog.scopeType }),
      "site",
    );
    await userEvent.click(within(dialog).getByRole("checkbox", { name: r.risk_owner.label }));
    await userEvent.click(within(dialog).getByRole("button", { name: t.dialog.save }));
    const site = within(dialog).getByRole("combobox", { name: t.dialog.site });
    expect(site.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByText(en.setup.errors.scope)).toBeTruthy();
    expect(grantRole).not.toHaveBeenCalled();

    grantRole.mockResolvedValue({ ok: true, data: {} });
    await userEvent.selectOptions(site, RIGA);
    await userEvent.click(within(dialog).getByRole("button", { name: t.dialog.save }));
    expect(grantRole).toHaveBeenCalledExactlyOnceWith(CARL, {
      role: "risk_owner",
      scope: { type: "site", id: RIGA },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("status").textContent).toBe(t.saved.replace("{name}", "Carl Ciso"));
  });

  it("grants and revokes the difference, one call at a time", async () => {
    grantRole.mockResolvedValue({ ok: true, data: {} });
    revokeRole.mockResolvedValue({ ok: true, data: {} });
    people();
    const dialog = await openFor("Anna Admin");
    const admin = within(dialog).getByRole<HTMLInputElement>("checkbox", {
      name: r.administrator.label,
    });
    expect(admin.checked).toBe(true);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: r.ciso.label }));
    await userEvent.click(admin);
    await userEvent.click(within(dialog).getByRole("button", { name: t.dialog.save }));
    await waitFor(() => {
      expect(revokeRole).toHaveBeenCalledWith(ADMIN_ROLE);
    });
    expect(grantRole).toHaveBeenCalledWith(ANNA, {
      role: "ciso",
      scope: { type: "organisation", id: null },
    });
    expect(grantRole.mock.invocationCallOrder[0]).toBeLessThan(
      revokeRole.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("sends the browser to sign in again when the API needs a recent sign-in", async () => {
    grantRole.mockResolvedValue({
      ok: false,
      kind: "reauth",
      details: [],
      href: "/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1",
    });
    people();
    const dialog = await openFor("Carl Ciso");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: r.ciso.label }));
    await userEvent.click(within(dialog).getByRole("button", { name: t.dialog.save }));
    expect(assign).toHaveBeenCalledWith("/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1");
  });

  it("shows the last-administrator message from en.json", async () => {
    revokeRole.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "lastAdministrator", message: "Cannot remove the last administrator" }],
    });
    people();
    const dialog = await openFor("Anna Admin");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: r.administrator.label }));
    await userEvent.click(within(dialog).getByRole("button", { name: t.dialog.save }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty(
      "textContent",
      en.setup.errors.lastAdministrator,
    );
    expect(screen.queryByText("Cannot remove the last administrator")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
