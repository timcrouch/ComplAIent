// @vitest-environment jsdom
import type { BoardOwnerRowDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardOwners } from "../../components/reports/board-owners";
import en from "../../messages/index";
import { withMessages } from "../intl";

const t = en.reports.board.owners;
const row = (over: Partial<BoardOwnerRowDto>): BoardOwnerRowDto => ({
  ownerId: "a",
  owner: "Oscar Owner",
  owned: 9,
  open: 8,
  closedNow: 1,
  treatedInPeriod: 1,
  overdueActions: 2,
  ...over,
});
const LONG = `<b>&"'${"x".repeat(80)}`;
const owners = [
  row({}),
  row({
    ownerId: "b",
    owner: "Zed Zero",
    overdueActions: 0,
    open: 3,
    owned: 3,
    closedNow: 0,
  }),
  row({ ownerId: "c", owner: LONG, overdueActions: 0 }),
  row({
    ownerId: null,
    owner: null,
    overdueActions: 0,
    open: 1,
    owned: 1,
    closedNow: 0,
  }),
];
const render = (o = owners) => withMessages(<BoardOwners owners={o} />);

describe("BoardOwners", () => {
  it("lists all rows as given, with the footnote and an Unassigned row", () => {
    render();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("Oscar Owner");
    expect(rows[1]?.textContent).toContain("Zed Zero");
    expect(rows[3]?.textContent).toContain(t.unassigned);
    expect(screen.getByText(t.footnote)).toBeTruthy();
    for (const h of [t.owner, t.owned, t.open, t.treated, t.overdue])
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy();
  });

  it("makes overdue red only above zero", () => {
    render();
    const rows = screen.getAllByRole("row").slice(1);
    const overdue = (r?: HTMLElement) => within(r as HTMLElement).getByTestId("overdue");
    expect(overdue(rows[0]).className).toContain("text-critical");
    expect(overdue(rows[1]).className).not.toContain("text-critical");
  });

  it("truncates long names with CSS and keeps the full name in a title, as text not markup", () => {
    const { container } = render();
    const cell = screen.getByTitle(LONG);
    expect(cell.className).toContain("truncate");
    expect(cell.textContent).toBe(LONG);
    expect(container.querySelector("b")).toBeNull();
  });

  it("draws an aria-hidden bar per row and no ranking words", () => {
    const { container } = render();
    const bars = container.querySelectorAll("tbody svg");
    expect(bars).toHaveLength(4);
    for (const b of bars) expect(b.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).not.toMatch(/lagging|\btop\b|\bbest\b/i);
  });

  it("says so when there are no owned risks", () => {
    render([]);
    expect(screen.getByText(t.empty)).toBeTruthy();
  });
});
