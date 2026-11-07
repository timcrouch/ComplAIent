// @vitest-environment jsdom
import type { RiskMapResponse } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CellChip } from "../../components/risks/cell-chip";
import { RiskFilters } from "../../components/risks/risk-filters";
import { RiskMap } from "../../components/risks/risk-map";
import { ViewSwitch } from "../../components/risks/view-switch";
import { withMessages } from "../intl";
import { SCALE } from "./fixtures";

const href = (l: number, i: number) => `/cell?l=${String(l)}&i=${String(i)}`;
const map = (over: Partial<RiskMapResponse> = {}): RiskMapResponse => ({
  basis: "inherent",
  appetiteThreshold: 9,
  cells: [
    { likelihood: 4, impact: 4, count: 4 },
    { likelihood: 1, impact: 2, count: 1 },
  ],
  total: 5,
  unscored: 0,
  unplaced: 0,
  ...over,
});

describe("RiskMap", () => {
  it("renders counts as links with an accessible name in words, above appetite included", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    const above = screen.getByRole("link", {
      name: "Above appetite: 4 risks, likelihood Likely, impact Major",
    });
    expect(above.getAttribute("href")).toBe("/cell?l=4&i=4");
    expect(above.textContent).toContain("4");
    expect(above.textContent).toContain("Above appetite");
    const within1 = screen.getByRole("link", {
      name: "Within appetite: 1 risk, likelihood Rare, impact Minor",
    });
    expect(within1.getAttribute("href")).toBe("/cell?l=1&i=2");
  });

  it("puts the most likely row on top and the lowest impact first", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    const grid = screen.getAllByRole("table")[0] as HTMLElement;
    const rows = within(grid).getAllByRole("row");
    expect(within(rows[2] as HTMLElement).getByRole("rowheader").textContent).toBe(
      "Almost certain",
    );
    expect(within(rows[rows.length - 1] as HTMLElement).getByRole("rowheader").textContent).toBe(
      "Rare",
    );
    const cols = within(rows[1] as HTMLElement).getAllByRole("columnheader");
    expect(cols.map((c) => c.textContent)).toEqual([
      "Likelihood",
      "Negligible",
      "Minor",
      "Moderate",
      "Major",
      "Severe",
    ]);
  });

  it("explains the colours in a legend", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    expect(screen.getByText("Legend", { exact: false })).toBeTruthy();
  });

  it("offers the non-empty cells as a table alternative", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    const details = screen.getByText("Show as table").closest("details") as HTMLElement;
    const rows = within(details).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const cells = within(rows[1] as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells).toEqual(["Likely", "Major", "16", "Above appetite", "4"]);
  });

  it("shows a calm line when there is nothing to place", () => {
    withMessages(<RiskMap map={map({ cells: [], total: 0 })} scale={SCALE} cellHref={href} />);
    expect(screen.getByText("No risks to place yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says how many risks are not on the map, with plurals", () => {
    const { unmount } = withMessages(
      <RiskMap map={map({ basis: "residual", unplaced: 1 })} scale={SCALE} cellHref={href} />,
    );
    expect(screen.getByText("1 risk has no expected score yet")).toBeTruthy();
    unmount();
    withMessages(
      <RiskMap
        map={map({ basis: "residual", unplaced: 4, unscored: 2 })}
        scale={SCALE}
        cellHref={href}
      />,
    );
    expect(screen.getByText("4 risks have no expected score yet")).toBeTruthy();
    expect(screen.getByText("2 risks are not scored yet")).toBeTruthy();
  });

  it("shows an overlay with a link when no risk has an expected score", () => {
    withMessages(
      <RiskMap
        map={map({ basis: "residual", cells: [], total: 3, unplaced: 3 })}
        scale={SCALE}
        cellHref={href}
      />,
    );
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "No risks have an expected score yet. A risk appears here once its expected score after treatment is entered.",
    );
    const link = within(note).getByRole("link", { name: "Show the 3 risks" });
    expect(link.getAttribute("href")).toBe("/risks?filter=noExpectedScore");
    expect(screen.queryByText("3 risks have no expected score yet")).toBeNull();
  });

  it("says 'risk' for a single unplaced risk and carries includeClosed on the link", () => {
    withMessages(
      <RiskMap
        map={map({ basis: "residual", cells: [], total: 1, unplaced: 1 })}
        scale={SCALE}
        cellHref={href}
        includeClosed
      />,
    );
    const link = within(screen.getByRole("note")).getByRole("link", { name: "Show the 1 risk" });
    expect(link.getAttribute("href")).toBe("/risks?filter=noExpectedScore&includeClosed=true");
  });

  it("puts the unplaced note above the grid, with a link, when some risks are placed", () => {
    withMessages(
      <RiskMap map={map({ basis: "residual", unplaced: 2 })} scale={SCALE} cellHref={href} />,
    );
    expect(screen.queryByRole("note")).toBeNull();
    const link = screen.getByRole("link", { name: "2 risks have no expected score yet" });
    expect(link.getAttribute("href")).toBe("/risks?filter=noExpectedScore");
    const grid = screen.getAllByRole("table")[0] as HTMLElement;
    expect(link.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never shows the overlay on the inherent basis", () => {
    withMessages(
      <RiskMap
        map={map({ basis: "inherent", cells: [], total: 0, unplaced: 3 })}
        scale={SCALE}
        cellHref={href}
      />,
    );
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("compact mode hides legend, axis titles and table but keeps accessible names", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} compact cellHref={href} />);
    expect(screen.queryByText("Show as table")).toBeNull();
    expect(screen.queryByText("Legend", { exact: false })).toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Above appetite: 4 risks, likelihood Likely, impact Major",
      }),
    ).toBeTruthy();
  });
});

describe("layout and captions", () => {
  it("keeps the five impact columns equal, with one fixed row-header column", () => {
    for (const compact of [false, true]) {
      const { container, unmount } = withMessages(
        <RiskMap map={map()} scale={SCALE} compact={compact} cellHref={href} />,
      );
      const table = container.querySelector("table") as HTMLElement;
      expect(table.className).toContain("table-fixed");
      const cols = table.querySelectorAll("colgroup col");
      expect(cols).toHaveLength(6);
      expect(cols[0]?.className).toMatch(/w-\[/);
      for (const c of Array.from(cols).slice(1)) expect(c.className).toBe("");
      unmount();
    }
  });

  it("compact mode shows small axis captions", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} compact cellHref={href} />);
    expect(screen.getByText("Likelihood ↑")).toBeTruthy();
    expect(screen.getByText("Impact →")).toBeTruthy();
  });

  it("full mode has no compact captions", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    expect(screen.queryByText("Likelihood ↑")).toBeNull();
    expect(screen.queryByText("Impact →")).toBeNull();
  });
});

describe("appetite region", () => {
  const cellAt = (l: string, i: string) => {
    const grid = screen.getAllByRole("table")[0] as HTMLElement;
    const row = within(grid)
      .getAllByRole("row")
      .find((r) => within(r).queryByRole("rowheader")?.textContent === l) as HTMLElement;
    const heads = within(within(grid).getAllByRole("row")[1] as HTMLElement).getAllByRole(
      "columnheader",
    );
    const col = heads.findIndex((c) => c.textContent === i);
    return row.querySelectorAll("td")[col - 1]?.firstElementChild as HTMLElement;
  };

  it("tints every above cell, even empty, and marks the boundary", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    // threshold 9: Possible(3) x Severe(5)=15 above, empty; Possible x Moderate=9 within.
    const empty = cellAt("Possible", "Severe");
    expect(empty.className).toContain("bg-critical-soft");
    expect(empty.className).toContain("text-critical");
    expect(empty.className).not.toContain("attention");
    expect(empty.getAttribute("aria-hidden")).toBe("true");
    expect(cellAt("Possible", "Moderate").className).not.toContain("bg-critical-soft");
    // 4x3=12 above, impact 2 left of it: 4x2=8 within -> left edge; below 3x3=9 within -> bottom edge.
    const edge = cellAt("Likely", "Moderate");
    expect(edge.dataset.edgeLeft).toBe("true");
    expect(edge.dataset.edgeBelow).toBe("true");
    expect(edge.className).toContain("border-l-critical");
    expect(edge.className).toContain("border-b-critical");
    expect(edge.className).not.toContain("attention");
    // 5x5: neighbours all above -> no edges.
    const inner = cellAt("Almost certain", "Severe");
    expect(inner.dataset.edgeLeft).toBeUndefined();
    expect(inner.dataset.edgeBelow).toBeUndefined();
  });

  it("leaves populated within cells untinted", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    const link = screen.getByRole("link", { name: /1 risk, likelihood Rare/ });
    expect(link.className).not.toContain("bg-ok-soft");
    expect(link.className).not.toContain("bg-critical-soft");
  });

  it("draws the legend line for above appetite in red", () => {
    withMessages(<RiskMap map={map()} scale={SCALE} cellHref={href} />);
    const legend = screen.getByText(/Above appetite|above appetite/, { selector: "p" });
    expect(legend.className).toContain("text-critical");
    expect(legend.className).not.toContain("attention");
  });
});

describe("CellChip and filters", () => {
  const cell = { likelihood: 4, impact: 4, basis: "inherent" as const };
  it("names the levels and keeps the filter on the clear link", () => {
    withMessages(<CellChip cell={cell} scale={SCALE} filter="toReview" />);
    expect(screen.getByText("Likelihood: Likely × Impact: Major (Now)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all risks" }).getAttribute("href")).toBe(
      "/risks?filter=toReview",
    );
  });
  it("falls back to numbers without a scale", () => {
    withMessages(<CellChip cell={{ ...cell, basis: "residual" }} scale={null} filter="all" />);
    expect(screen.getByText("Likelihood: 4 × Impact: 4 (Expected)")).toBeTruthy();
  });
  it("filter links keep the cell", () => {
    withMessages(<RiskFilters current="all" cell={cell} />);
    expect(screen.getByRole("link", { name: "To review" }).getAttribute("href")).toBe(
      "/risks?filter=toReview&likelihood=4&impact=4&basis=inherent",
    );
  });
});

describe("ViewSwitch", () => {
  it("marks the active view and basis", () => {
    withMessages(<ViewSwitch view="map" basis="residual" />);
    expect(screen.getByRole("link", { name: "Map" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "List" }).getAttribute("aria-current")).toBeNull();
    const expected = screen.getByRole("link", { name: "Expected" });
    expect(expected.getAttribute("aria-current")).toBe("true");
    expect(expected.getAttribute("href")).toBe("/risks?view=map&basis=residual");
    expect(screen.getByRole("link", { name: "Now" }).getAttribute("href")).toBe(
      "/risks?view=map&basis=inherent",
    );
    expect(screen.getByRole("link", { name: "List" }).getAttribute("href")).toBe("/risks");
  });
});
