// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnitsForm } from "../components/setup/units-form";
import { consumeStepHeadingFocus } from "../lib/step-focus";
import en from "../messages/index";
import { clickLink, withMessages } from "./intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const saveUnits = vi.fn();
vi.mock("../lib/actions/setup", () => ({
  saveUnits: (...args: unknown[]) => saveUnits(...args) as unknown,
}));
vi.mock("../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.setup.sites;
const RIGA = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const BERLIN = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const countries = [
  { code: "DE", name: "Germany" },
  { code: "LV", name: "Latvia" },
];
const riga = { id: RIGA, name: "Riga office", countryCode: "LV" };
const berlin = { id: BERLIN, name: "Berlin", countryCode: "DE" };

function form(sites = [riga], departments: { id: string; name: string }[] = []) {
  return withMessages(
    <UnitsForm initialSites={sites} initialDepartments={departments} countries={countries} />,
  );
}

const siteNames = () => screen.getAllByRole<HTMLInputElement>("textbox", { name: t.siteName });
const continueButton = () => screen.getByRole("button", { name: en.setup.continue });

beforeEach(() => {
  push.mockReset();
  saveUnits.mockReset().mockResolvedValue({ ok: true, data: { sites: [], departments: [] } });
});

describe("UnitsForm", () => {
  it("adds and removes rows with labelled buttons and moves focus to the new row", async () => {
    form();
    expect(screen.getByText(t.departmentsHint)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: t.addSite }));
    expect(siteNames()).toHaveLength(2);
    expect(document.activeElement).toBe(siteNames()[1]);
    expect(screen.getByRole("button", { name: "Remove site 2" })).toBeTruthy();
    await userEvent.type(siteNames()[1] as HTMLElement, "Berlin");
    await userEvent.selectOptions(
      screen.getAllByRole("combobox", { name: t.country })[1] as HTMLElement,
      "DE",
    );
    expect(screen.getByRole("button", { name: "Remove Berlin" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Remove Riga office" }));
    expect(siteNames().map((i) => i.value)).toEqual(["Berlin"]);

    await userEvent.click(screen.getByRole("button", { name: t.addDepartment }));
    const department = screen.getByRole("textbox", { name: t.departmentName });
    expect(document.activeElement).toBe(department);
    await userEvent.type(department, " Finance ");
    expect(screen.getByRole("button", { name: "Remove Finance" })).toBeTruthy();

    await userEvent.click(continueButton());
    expect(saveUnits).toHaveBeenCalledWith({
      sites: [{ name: "Berlin", countryCode: "DE" }],
      departments: [{ name: "Finance" }],
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/setup/frameworks");
    });
    expect(consumeStepHeadingFocus()).toBe(true);
  });

  it("shows the site-in-use message on the row that cannot be removed", async () => {
    saveUnits.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: `siteInUse.${RIGA}`, message: "Riga is used by 3 assets" }],
    });
    form([riga, berlin]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Riga office" }));
    await userEvent.click(continueButton());
    expect(saveUnits).toHaveBeenCalledWith({
      sites: [{ id: BERLIN, name: "Berlin", countryCode: "DE" }],
      departments: [],
    });
    const restored = await screen.findByDisplayValue("Riga office");
    const row = restored.closest("fieldset") as HTMLElement;
    expect(within(row).getByText(en.setup.errors.siteInUse)).toBeTruthy();
    expect(screen.queryByText(/3 assets/)).toBeNull();
    expect(siteNames().map((i) => i.value)).toEqual(["Riga office", "Berlin"]);
    expect(push).not.toHaveBeenCalled();
    expect(consumeStepHeadingFocus()).toBe(false);
  });

  it("names a duplicate and an out-of-date row with their own messages", async () => {
    saveUnits.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "sites.0.id", message: "Unknown id" }],
    });
    form([riga]);
    await userEvent.click(screen.getByRole("button", { name: t.addSite }));
    await userEvent.type(siteNames()[1] as HTMLElement, "RIGA OFFICE");
    await userEvent.selectOptions(
      screen.getAllByRole("combobox", { name: t.country })[1] as HTMLElement,
      "LV",
    );
    await userEvent.click(continueButton());
    expect(saveUnits).not.toHaveBeenCalled();
    expect(siteNames()[1]?.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(en.setup.errors.siteNameDuplicate)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Remove RIGA OFFICE" }));
    await userEvent.click(continueButton());
    const row = (await screen.findByText(en.setup.errors.staleSite)).closest("fieldset");
    expect(row?.contains(siteNames()[0] as HTMLElement)).toBe(true);
  });

  it("requires at least one site before continuing", async () => {
    form([]);
    expect(siteNames()).toHaveLength(1);
    await userEvent.click(continueButton());
    expect(screen.getByText(en.setup.errors.siteName)).toBeTruthy();
    expect(screen.getByText(en.setup.errors.country)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Remove site 1" }));
    expect(screen.queryAllByRole("textbox", { name: t.siteName })).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t.addSite }));
    await userEvent.click(continueButton());
    expect(screen.getByText(en.setup.errors.sitesRequired)).toBeTruthy();
    expect(saveUnits).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: t.addSite }));
    });
  });
});

describe("UnitsForm list-level problems", () => {
  it("only an empty site list says 'add at least one site'", async () => {
    saveUnits.mockResolvedValue({ ok: false, kind: "conflict", details: [{ path: "other" }] });
    form([riga]);
    await userEvent.click(continueButton());
    expect(await screen.findByText(en.setup.errors.notAccepted)).toBeTruthy();
    expect(screen.queryByText(en.setup.errors.unavailable)).toBeNull();
    expect(screen.queryByText(en.setup.errors.sitesRequired)).toBeNull();
  });
});

describe("UnitsForm Back link", () => {
  it("requests the focus move to the previous step's heading", () => {
    form([riga]);
    clickLink(screen.getByRole("link", { name: en.setup.back }));
    expect(consumeStepHeadingFocus()).toBe(true);
  });
});
