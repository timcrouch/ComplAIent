// @vitest-environment jsdom
import type { RiskScaleDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppetiteForm } from "../components/setup/appetite-form";
import { AppetiteGrid } from "../components/setup/appetite-grid";
import en from "../messages/index";
import { withMessages } from "./intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const saveRiskAppetite = vi.fn();
vi.mock("../lib/actions/setup", () => ({
  saveRiskAppetite: (...args: unknown[]) => saveRiskAppetite(...args) as unknown,
}));
vi.mock("../lib/navigate", () => ({ goTo: vi.fn() }));

const levels = (names: string[]) =>
  names.map((label, i) => ({ value: i + 1, label, description: `${label} description` }));
const scale: RiskScaleDto = {
  version: null,
  appetiteThreshold: 9,
  likelihood: levels(["Rare", "Unlikely", "Possible", "Likely", "Almost certain"]),
  impact: levels(["Minimal", "Minor", "Moderate", "Major", "Severe"]),
};
const t = en.setup.riskAppetite;

/** The cell for likelihood `l` (column) and impact `i` (row). */
function cell(table: HTMLElement, likelihood: number, impact: number): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .find(
      (r) => within(r).queryByRole("rowheader")?.textContent === scale.impact[impact - 1]?.label,
    );
  return within(row as HTMLElement).getAllByRole("cell")[likelihood - 1] as HTMLElement;
}

beforeEach(() => {
  push.mockReset();
  saveRiskAppetite.mockReset().mockResolvedValue({ ok: true, data: scale });
});

describe("AppetiteForm", () => {
  it("offers three presets with Balanced selected by default", () => {
    withMessages(<AppetiteForm scale={scale} saved={null} />);
    const group = screen.getByRole("radiogroup", { name: t.legend });
    const radios = within(group).getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual([
      expect.stringContaining(t.presets.cautious.label),
      expect.stringContaining(t.presets.balanced.label),
      expect.stringContaining(t.presets.bold.label),
    ]);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["balanced"]);
    expect(screen.getByText(t.presets.balanced.description)).toBeTruthy();
  });

  it("keeps the saved preset, updates the preview and saves the chosen threshold", async () => {
    withMessages(<AppetiteForm scale={{ ...scale, version: 1 }} saved={14} />);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Bold/ }).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: /Cautious/ }));
    expect(within(cell(screen.getByRole("table"), 1, 5)).getByText(t.above)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveRiskAppetite).toHaveBeenCalledWith(4);
    expect(push).toHaveBeenCalledWith("/setup/people");
  });
});

describe("AppetiteGrid", () => {
  it("the grid is a table whose 25 cells say in words whether they are within appetite", () => {
    withMessages(<AppetiteGrid scale={scale} threshold={9} />);
    const table = screen.getByRole("table");
    expect(table.querySelector("caption")?.textContent).toBe(t.caption);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((h) => h.textContent),
    ).toEqual([...scale.impact].reverse().map((l) => l.label));
    const columns = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    for (const level of scale.likelihood) expect(columns).toContain(level.label);

    const body = table.querySelector("tbody") as HTMLElement;
    const cells = within(body).getAllByRole("cell");
    expect(cells).toHaveLength(25);
    for (const c of cells) {
      expect(c.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(c.textContent).toMatch(new RegExp(`^\\d+(${t.within}|${t.above})$`));
    }
    expect(cell(table, 3, 3).textContent).toBe(`9${t.within}`);
    expect(cell(table, 2, 5).textContent).toBe(`10${t.above}`);
    expect(screen.queryAllByText("Needs a second approver")).toEqual([]);
  });

  it("shows cells above appetite in red with the triangle and the words, never amber", () => {
    withMessages(<AppetiteGrid scale={scale} threshold={9} />);
    const above = cell(screen.getByRole("table"), 2, 5);
    const flagged = above.querySelector("[data-above]") ?? above;
    expect(flagged.className).toContain("bg-critical-soft");
    expect(flagged.className).toContain("text-critical");
    expect(flagged.className).not.toContain("attention");
    expect(above.textContent).toContain(t.above);
    expect(above.querySelector("svg")?.getAttribute("class")).toContain("lucide-triangle-alert");
  });
});
