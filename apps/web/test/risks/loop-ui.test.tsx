// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskFilters } from "../../components/risks/risk-filters";
import { RiskStateBadge } from "../../components/risks/risk-badges";
import { RiskJourney } from "../../components/risks/risk-journey";
import { ViewSwitch } from "../../components/risks/view-switch";
import { Statements } from "../../components/home/statements";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, riskDetail } from "./fixtures";

const NOW = new Date("2026-11-08T09:00:00.000Z");
const base = riskDetail().journey;
const closedSteps = [
  { key: "reported", status: "done", at: "2026-11-05T09:00:00.000Z", by: CARL },
  { key: "under_review", status: "done", at: "2026-11-05T09:00:00.000Z", by: CARL },
  { key: "awaiting_approval", status: "done", at: "2026-11-06T09:00:00.000Z", by: CARL },
  { key: "approved", status: "done", at: "2026-11-06T09:00:00.000Z", by: CARL },
  { key: "closed", status: "current", at: "2026-11-07T09:00:00.000Z", by: CARL },
] as const;

describe("journey: closed and reassessed", () => {
  it("shows the Treated step as current when the risk is closed", () => {
    withMessages(
      <RiskJourney
        journey={{
          ...base,
          steps: [...closedSteps],
          waitingOn: { kind: "review", nextReviewDue: "2027-05-07" },
        }}
        timeZone="UTC"
        now={NOW}
      />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[4]?.getAttribute("aria-current")).toBe("step");
    expect(items[4]?.textContent).toContain("Treated");
    expect(items[4]?.textContent).toContain("Next review due 7 May 2027");
  });

  it("labels the first step Reassessed in a reassessed cycle", () => {
    withMessages(
      <RiskJourney journey={{ ...base, cycle: "reassessed" }} timeZone="UTC" now={NOW} />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Reassessed");
    expect(items[0]?.textContent).not.toContain("Reported");
  });
});

describe("map toggle, filter, badge, statements", () => {
  it("says treated risks are hidden on the map and offers to show them", () => {
    withMessages(<ViewSwitch view="map" basis="inherent" includeClosed={false} />);
    expect(screen.getByText(en.insights.view.treatedHidden)).toBeTruthy();
    const toggle = screen.getByRole("link", { name: "Show treated risks" });
    expect(toggle.getAttribute("href")).toBe("/risks?view=map&basis=inherent&includeClosed=true");
    expect(toggle.getAttribute("aria-current")).toBeNull();
  });

  it("says treated risks are shown, offers to hide them, and keeps it across the basis links", () => {
    withMessages(<ViewSwitch view="map" basis="residual" includeClosed />);
    expect(screen.getByText(en.insights.view.treatedShown)).toBeTruthy();
    const toggle = screen.getByRole("link", { name: "Hide treated risks" });
    expect(toggle.getAttribute("aria-current")).toBeNull();
    expect(toggle.getAttribute("href")).toBe("/risks?view=map&basis=residual");
    const expected = screen.getByRole("link", { name: en.insights.view.expected });
    expect(expected.getAttribute("href")).toBe("/risks?view=map&basis=residual&includeClosed=true");
  });

  it("does not show the toggle in the list view", () => {
    withMessages(<ViewSwitch view="list" basis="inherent" includeClosed={false} />);
    expect(screen.queryByRole("link", { name: /treated risks/ })).toBeNull();
    expect(screen.queryByText(en.insights.view.treatedHidden)).toBeNull();
  });

  it("has a Due for review filter", () => {
    withMessages(<RiskFilters current="reviewDue" />);
    const link = screen.getByRole("link", { name: "Due for review" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("href")).toBe("/risks?filter=reviewDue");
  });

  it("badges a closed risk as Treated", () => {
    withMessages(<RiskStateBadge state="closed" />);
    expect(screen.getByText("Treated")).toBeTruthy();
  });

  it("says the new home statements in plain words", () => {
    withMessages(
      <Statements
        statements={[
          { key: "actionsOverdue", count: 2, href: "/tasks" },
          { key: "reviewsDue", count: 1, href: "/risks?filter=reviewDue" },
        ]}
      />,
    );
    expect(screen.getByText("2 actions are overdue")).toBeTruthy();
    expect(screen.getByText("1 risk is due for review")).toBeTruthy();
  });
});
