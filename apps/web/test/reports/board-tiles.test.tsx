// @vitest-environment jsdom
import type { BoardTileDto } from "@isms/contracts";
import { BOARD_TILES } from "@isms/domain";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardTiles } from "../../components/reports/board-tiles";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { PACK } from "./board-fixtures";

const t = en.reports.board.tiles;
const vs = (key: string) => ({
  kind: "previousPeriod" as const,
  period: { key, start: "", end: "" },
});
const tiles: BoardTileDto[] = [
  {
    key: "openRisks",
    value: 17,
    change: {
      delta: 3,
      direction: "up",
      tone: "neutral",
      basis: vs("2026-09"),
    },
  },
  {
    key: "aboveAppetite",
    value: 5,
    change: {
      delta: 2,
      direction: "down",
      tone: "better",
      basis: vs("2026-09"),
    },
  },
  {
    key: "reported",
    value: 8,
    change: {
      delta: 2,
      direction: "down",
      tone: "neutral",
      basis: vs("prev-30-days"),
    },
  },
  {
    key: "approved",
    value: 6,
    change: {
      delta: 0,
      direction: "same",
      tone: "neutral",
      basis: vs("2026-09"),
    },
  },
  {
    key: "closed",
    value: 2,
    change: {
      delta: 2,
      direction: "up",
      tone: "neutral",
      basis: { kind: "since", date: "2026-10-01" },
    },
  },
  { key: "overdueActions", value: 4, change: null },
  { key: "reviewsDue", value: 3, change: null },
];
const render = (over: BoardTileDto[] = tiles) =>
  withMessages(<BoardTiles tiles={over} periodLabel="September 2026" />);

describe("BoardTiles", () => {
  it("shows seven tiles in order, each with a label and an icon", () => {
    const { container } = render();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);
    BOARD_TILES.forEach((def, i) => {
      const item = items[i] as HTMLElement;
      expect(within(item).getByText(t.label[def.key])).toBeTruthy();
      const icon = item.querySelector("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    });
    expect(container.textContent).toContain("Treated");
  });

  it("writes change lines like the PDF", () => {
    render();
    {
      const line = screen.getByText("3 vs Sep");
      expect(line.textContent).toBe("▲3 vs Sep");
      expect(line.querySelector("[aria-hidden='true']")?.textContent).toBe("▲");
    }
    {
      const line = screen.getByText("2 vs previous 30 days");
      expect(line.textContent).toBe("▼2 vs previous 30 days");
      expect(line.querySelector("[aria-hidden='true']")?.textContent).toBe("▼");
    }
    expect(screen.getByText("No change vs Sep")).toBeTruthy();
    {
      const line = screen.getByText("2 since 1 Oct");
      expect(line.textContent).toBe("▲2 since 1 Oct");
      expect(line.querySelector("[aria-hidden='true']")?.textContent).toBe("▲");
    }
    expect(screen.getAllByText("now")).toHaveLength(2);
  });

  it("colours only above appetite, with the word more or fewer", () => {
    render();
    const fewer = screen.getByText("2 fewer vs Sep");
    expect(fewer.className).toContain("text-ok");
    expect(screen.getByText("3 vs Sep").className).not.toMatch(/text-(ok|critical)/);
  });

  it("shows more in red", () => {
    const worse = tiles.map((x) =>
      x.key === "aboveAppetite" && x.change
        ? {
            ...x,
            change: {
              ...x.change,
              direction: "up" as const,
              tone: "worse" as const,
            },
          }
        : x,
    );
    render(worse);
    expect(screen.getByText("2 more vs Sep").className).toContain("text-critical");
  });

  it("explains the basis in small print and never ranks or labels", () => {
    const { container } = render();
    expect(screen.getByText(/September 2026/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/lagging|\btop\b|\bbest\b/i);
    expect(PACK.tiles).toHaveLength(7);
  });
});
