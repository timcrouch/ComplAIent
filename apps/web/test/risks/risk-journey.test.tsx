// @vitest-environment jsdom
import type { RiskJourneyDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskJourney } from "../../components/risks/risk-journey";
import { withMessages } from "../intl";
import { CARL, OLGA, RITA, riskDetail } from "./fixtures";

const NOW = new Date("2026-11-08T09:00:00.000Z");
const base = riskDetail().journey;
const journey = (over: Partial<RiskJourneyDto> = {}): RiskJourneyDto => ({ ...base, ...over });
const show = (j: RiskJourneyDto) =>
  withMessages(<RiskJourney journey={j} timeZone="UTC" now={NOW} />);

describe("RiskJourney", () => {
  it("lists the four steps with the current one marked", () => {
    show(journey());
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
    expect(items[0]?.textContent).toContain("Reported");
    expect(items[0]?.textContent).toContain("Done");
    expect(items[0]?.textContent).toContain("5 November 2026");
    expect(items[0]?.textContent).toContain("Rita Reporter");
    expect(items[1]?.textContent).toContain("Being reviewed");
    expect(items[1]?.textContent).toContain("Current");
    expect(items[2]?.textContent).toContain("Waiting for approval");
    expect(items[2]?.textContent).toContain("Upcoming");
    expect(items[3]?.textContent).toContain("Approved");
  });

  it("says who it waits on and for how long", () => {
    show(journey({ waitingOn: { kind: "owner", owner: OLGA } }));
    expect(screen.getByText("Waiting on Olga Owner")).toBeTruthy();
    expect(screen.getByText("Waiting 3 days")).toBeTruthy();
  });

  it("says when there is no owner yet", () => {
    show(journey());
    expect(screen.getByText("No owner yet")).toBeTruthy();
  });

  it("names the reviewer rule", () => {
    show(
      journey({
        waitingOn: {
          kind: "approver",
          rule: "reviewerMayApprove",
          reviewer: CARL,
          eligibleApprovers: [CARL],
          eligibleApproverCount: 1,
          noEligibleApprover: false,
        },
      }),
    );
    expect(screen.getByText("The reviewer Carl Ciso or an approver can approve")).toBeTruthy();
  });

  it("lists independent approvers and how many more", () => {
    show(
      journey({
        waitingOn: {
          kind: "approver",
          rule: "independentApprover",
          reviewer: CARL,
          eligibleApprovers: [OLGA, RITA],
          eligibleApproverCount: 5,
          noEligibleApprover: false,
        },
      }),
    );
    expect(
      screen.getByText("Needs an independent approver: Olga Owner, Rita Reporter and 3 more"),
    ).toBeTruthy();
  });

  it("says less than a minute for a fresh step", () => {
    show(journey({ since: "2026-11-08T08:59:40.000Z", waitingOn: { kind: "owner", owner: OLGA } }));
    expect(screen.getByText("Waiting less than a minute")).toBeTruthy();
  });

  it("names no one, without a colon or list, when the names are withheld", () => {
    show(
      journey({
        waitingOn: {
          kind: "approver",
          rule: "independentApprover",
          reviewer: CARL,
          eligibleApprovers: [],
          eligibleApproverCount: 3,
          noEligibleApprover: false,
        },
      }),
    );
    expect(screen.getByText("Needs an independent approver")).toBeTruthy();
    expect(screen.queryByText(/approver:/)).toBeNull();
  });

  it("says plainly when no one else can approve", () => {
    show(
      journey({
        waitingOn: {
          kind: "approver",
          rule: "independentApprover",
          reviewer: CARL,
          eligibleApprovers: [],
          eligibleApproverCount: 0,
          noEligibleApprover: true,
        },
      }),
    );
    expect(
      screen.getByText(
        "No one else can approve this yet — an administrator can give the approver role to someone",
      ),
    ).toBeTruthy();
  });

  it("shows nothing about waiting for kind none", () => {
    show(journey({ waitingOn: { kind: "none" } }));
    expect(screen.queryByText(/Waiting on/)).toBeNull();
  });

  it("lists returns in a details element", () => {
    show(
      journey({
        returnCount: 2,
        returns: [
          { at: "2026-11-02T08:00:00.000Z", by: CARL, comment: "Add evidence" },
          { at: "2026-11-04T08:00:00.000Z", by: CARL, comment: "Clarify impact" },
        ],
      }),
    );
    expect(screen.getByText("Returned 2 times")).toBeTruthy();
    const details = screen.getByText("Returned 2 times").closest("details") as HTMLElement;
    expect(details.textContent).toContain("Add evidence");
    expect(details.textContent).toContain("Clarify impact");
    expect(details.textContent).toContain("2 November 2026");
  });

  it("shows no returns line when never returned", () => {
    show(journey());
    expect(screen.queryByText(/Returned/)).toBeNull();
  });
});
