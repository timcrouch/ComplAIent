// @vitest-environment jsdom
import type { RiskPictureDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeView } from "../../components/home/home-view";
import { RiskPicture } from "../../components/home/risk-picture";
import { withMessages } from "../intl";
import { SCALE } from "../risks/fixtures";
import { WORKSPACE } from "./fixtures";

const weeks = (f: (i: number) => [number, number, number]) =>
  Array.from({ length: 12 }, (_, i) => {
    const [reported, approved, closed] = f(i);
    return {
      weekStart: `2026-${i < 9 ? "08" : "09"}-${String(i + 1).padStart(2, "0")}`,
      reported,
      approved,
      closed,
    };
  });
const picture = (movement = weeks(() => [0, 0, 0])): RiskPictureDto => ({
  map: {
    basis: "inherent",
    appetiteThreshold: 9,
    cells: [{ likelihood: 4, impact: 4, count: 2 }],
    total: 2,
    unscored: 0,
    unplaced: 0,
  },
  movement,
});

describe("RiskPicture", () => {
  it("shows a compact map linking to the map view and the movement", () => {
    withMessages(<RiskPicture picture={picture()} scale={SCALE} />);
    expect(screen.getByRole("heading", { name: "Risk picture" })).toBeTruthy();
    const cell = screen.getByRole("link", {
      name: /Above appetite: 2 risks, likelihood Likely, impact Major/,
    });
    expect(cell.getAttribute("href")).toBe("/risks?view=map");
    expect(screen.getByRole("heading", { name: "Last 12 weeks" })).toBeTruthy();
  });

  it("renders 12 weeks and the table with all zeros, without NaN", () => {
    const { container } = withMessages(<RiskPicture picture={picture()} scale={SCALE} />);
    expect(screen.getAllByTestId("movement-week")).toHaveLength(12);
    expect(container.innerHTML).not.toContain("NaN");
    const table = screen.getByRole("table", {
      name: "Risks reported, approved and marked as treated per week",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    for (const bar of screen.getAllByTestId("movement-bar")) {
      expect(bar.style.height).toBe("0%");
    }
  });

  it("scales bars to the largest weekly value", () => {
    withMessages(
      <RiskPicture
        picture={picture(weeks((i) => (i === 3 ? [8, 2, 0] : i === 5 ? [4, 4, 6] : [0, 0, 0])))}
        scale={SCALE}
      />,
    );
    const bars = screen.getAllByTestId("movement-bar");
    const heights = bars.map((b) => b.style.height);
    expect(heights[9]).toBe("100%"); // week 3 reported
    expect(heights[10]).toBe("25%"); // week 3 approved
    expect(heights[15]).toBe("50%"); // week 5 reported
    expect(heights[17]).toBe("75%"); // week 5 marked as treated
    expect(screen.getByTitle(/8 reported/)).toBeTruthy();
    expect(screen.getByTitle(/6 marked as treated/)).toBeTruthy();
    const table = screen.getByRole("table", {
      name: "Risks reported, approved and marked as treated per week",
    });
    expect(within(table).getByRole("columnheader", { name: "Marked as treated" })).toBeTruthy();
    expect(screen.getAllByText("Reported").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("movement-bar")[0]?.closest("[aria-hidden=true]")).toBeTruthy();
  });
});

describe("HomeView risk picture", () => {
  const props = {
    greeting: "Hi",
    canSetUp: false,
    setupDone: true,
    justFinished: false,
  };
  it("is hidden when null", () => {
    withMessages(<HomeView {...props} workspace={WORKSPACE} />);
    expect(screen.queryByRole("heading", { name: "Risk picture" })).toBeNull();
  });
  it("is shown when present", () => {
    withMessages(
      <HomeView {...props} workspace={{ ...WORKSPACE, riskPicture: picture() }} scale={SCALE} />,
    );
    expect(screen.getByRole("heading", { name: "Risk picture" })).toBeTruthy();
  });
});
