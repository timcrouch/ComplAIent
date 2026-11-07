// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeaderScores } from "../../components/risks/header-scores";
import { RiskProvider } from "../../components/risks/risk-context";
import { ScoreBadges } from "../../components/risks/risk-badges";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { riskDetail } from "./fixtures";

vi.mock("../../lib/actions/risks", () => ({ getRisk: vi.fn() }));

describe("above appetite is red, never amber", () => {
  it("the score badge carries the triangle, the words and text-critical", () => {
    const { container } = withMessages(<ScoreBadges score={16} aboveAppetite />);
    const badge = container.querySelector("[data-slot=status-badge]") as HTMLElement;
    expect(badge.textContent).toBe(en.risks.score.aboveAppetite);
    expect(badge.className).toContain("text-critical");
    expect(badge.className).not.toContain("attention");
    expect(badge.querySelector("svg")?.getAttribute("class")).toContain("lucide-triangle-alert");
  });

  it("the header score part keeps its words and icon and turns red", () => {
    const { container } = withMessages(
      <RiskProvider initial={riskDetail({ score: 16, aboveAppetite: true })} timeZone="UTC">
        <HeaderScores />
      </RiskProvider>,
    );
    const part = container.querySelector("[data-above-appetite=true]") as HTMLElement;
    expect(part.textContent).toContain(en.insights.header.above);
    const icon = part.querySelector("svg") as SVGElement;
    expect(icon.getAttribute("class")).toContain("text-critical");
    expect(icon.getAttribute("class")).not.toContain("text-attention");
    expect(part.innerHTML).not.toContain("attention");
    expect(screen.getByTestId("header-scores")).toBeTruthy();
  });
});
