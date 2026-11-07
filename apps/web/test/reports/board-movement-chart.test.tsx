// @vitest-environment jsdom
import type { BoardMovementWeekDto } from "@isms/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardMovementChart } from "../../components/reports/board-movement-chart";
import en from "../../messages/index";
import { withMessages } from "../intl";

const t = en.reports.board.movement;
const weeks = (f: (i: number) => Partial<BoardMovementWeekDto>): BoardMovementWeekDto[] =>
  Array.from({ length: 12 }, (_, i) => ({
    weekStart: `2026-10-${String(i + 1).padStart(2, "0")}`,
    reported: 0,
    approved: 0,
    closed: 0,
    openAtEnd: 0,
    ...f(i),
  }));
const render = (w: BoardMovementWeekDto[]) => withMessages(<BoardMovementChart weeks={w} />);

describe("BoardMovementChart", () => {
  it("is an image described by a hidden summary, with a legend", () => {
    const { container } = render(weeks((i) => ({ reported: i, openAtEnd: 10 })));
    const img = screen.getByRole("img");
    const summary = container.querySelector(`#${img.getAttribute("aria-labelledby") ?? "x"}`);
    expect(summary?.className).toContain("sr-only");
    expect(summary?.textContent).toContain("12 weeks");
    for (const l of Object.values(t.legend))
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
  });

  it("says 'risk was' for one open risk and 'risks were' for others", () => {
    const text = (open: number) => {
      const { container, unmount } = render(weeks((i) => ({ openAtEnd: i === 11 ? open : 0 })));
      const img = screen.getByRole("img");
      const s = container.querySelector(`#${img.getAttribute("aria-labelledby") ?? "x"}`);
      const out = s?.textContent ?? "";
      unmount();
      return out;
    };
    expect(text(1)).toContain("1 risk was open");
    expect(text(5)).toContain("5 risks were open");
  });

  it("keeps the numbers table in the DOM, collapsed behind Show as table", () => {
    const { container } = render(weeks((i) => ({ reported: i, openAtEnd: 10 })));
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(screen.getByText(t.showTable)).toBeTruthy();
    const table = details?.querySelector("table");
    expect(table?.querySelectorAll("tr")).toHaveLength(5);
    expect(table?.textContent).toContain("1 Oct");
  });

  it("gives the open line its own labelled axis when it dwarfs the bars", () => {
    render(weeks(() => ({ reported: 3, openAtEnd: 120 })));
    expect(screen.getAllByText(t.openAxis).length).toBeGreaterThan(0);
    expect(document.querySelector("svg text")?.textContent).toBeDefined();
    expect(screen.getByRole("img").textContent).toContain("120");
  });

  it("keeps the right axis title clear of the axis numbers, with a mid tick (#16)", () => {
    // The sample company: 77 open risks against weekly bars of 0 to 4 (P8-R4).
    const { container } = render(weeks((i) => ({ reported: i % 5, openAtEnd: 70 + (i % 8) })));
    const svg = container.querySelector("svg[role=img]");
    const font = Number(svg?.getAttribute("font-size"));
    const right = [...(svg?.querySelectorAll("g.fill-accent text") ?? [])];
    expect(right.map((x) => x.textContent)).toEqual([t.openAxis, "0", "39", "77"]);
    const ys = [...(svg?.querySelectorAll("text") ?? [])]
      .filter((x) => /^\d+$/.test(x.textContent))
      .map((x) => Number(x.getAttribute("y")));
    const title = Number(right[0]?.getAttribute("y"));
    // The title fits inside the chart and sits a font height clear of every tick label.
    expect(title).toBeGreaterThanOrEqual(font);
    expect(title + font).toBeLessThanOrEqual(Math.min(...ys) - font);
  });

  it("shares one axis when the line is comparable, and never draws a max of 0", () => {
    const { container, unmount } = render(weeks(() => ({ reported: 5, openAtEnd: 10 })));
    expect(container.querySelector("svg[role=img]")?.textContent).not.toContain(t.openAxis);
    unmount();
    const zero = render(weeks(() => ({})));
    const labels = [...zero.container.querySelectorAll("svg[role=img] text")].map(
      (x) => x.textContent,
    );
    expect(labels).toContain("1");
    expect(labels.join("")).not.toContain("NaN");
  });
});
