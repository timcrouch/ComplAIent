// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, RISK_ID, SCALE, conflict, control, ok, riskDetail } from "./fixtures";

const getRisk = vi.fn();
const requestControlSuggestions = vi.fn();
const decideControl = vi.fn();
const addControl = vi.fn();
const removeControl = vi.fn();
const searchControls = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  updateRisk: vi.fn(),
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  requestControlSuggestions: (...a: unknown[]) => requestControlSuggestions(...a) as unknown,
  decideControl: (...a: unknown[]) => decideControl(...a) as unknown,
  addControl: (...a: unknown[]) => addControl(...a) as unknown,
  removeControl: (...a: unknown[]) => removeControl(...a) as unknown,
  searchControls: (...a: unknown[]) => searchControls(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;
const ID_A = "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d";
const ID_B = "8b9c0d1e-2f3a-4b4c-9d6e-7f8a9b0c1d2e";
const SUGGESTED = [
  control({ id: ID_A, code: "AST-01", title: "Asset inventory" }),
  control({ id: ID_B, code: "PHY-02", title: "Secure areas" }),
];

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      evidenceMaxBytes={1000}
      canSearchLibrary
      timeZone="UTC"
    />,
  );
}

const controls = () => screen.getByRole("region", { name: t.controls.title });

beforeEach(() => {
  for (const fn of [
    getRisk,
    requestControlSuggestions,
    decideControl,
    addControl,
    removeControl,
    searchControls,
  ]) {
    fn.mockReset();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Controls", () => {
  it("labels each suggestion as AI with its code, title, reason and references", () => {
    detail(
      riskDetail({ controls: SUGGESTED, controlSuggestion: { status: "ready", failure: null } }),
    );
    const list = within(controls()).getByRole("list", { name: t.controls.suggestionsLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = items[0];
    if (!first) throw new Error("no suggestion");
    expect(
      within(first).getByText(t.controls.suggestedBadge).closest("[data-slot=ai-badge]"),
    ).toBeTruthy();
    expect(first.textContent).toContain("AST-01");
    expect(first.textContent).toContain("Asset inventory");
    expect(first.textContent).toContain("Matches the scenario described.");
    expect(first.textContent).toContain("iso27001-2022 A.5.9");
  });

  it("accepts and rejects suggestions one by one, with an optional reason, keeping focus", async () => {
    const accepted = control({
      id: ID_A,
      status: "accepted",
      decidedBy: CARL,
      decidedAt: "2026-11-05T10:00:00.000Z",
    });
    decideControl.mockResolvedValueOnce(
      ok(riskDetail({ version: 3, controls: [accepted, SUGGESTED[1] ?? control()] })),
    );
    detail(
      riskDetail({ controls: SUGGESTED, controlSuggestion: { status: "ready", failure: null } }),
    );
    const list = within(controls()).getByRole("list", { name: t.controls.suggestionsLabel });
    await userEvent.click(within(list).getByRole("button", { name: "Accept AST-01" }));
    expect(decideControl).toHaveBeenCalledWith(RISK_ID, ID_A, 2, "accept", undefined);
    // Focus moves to the next suggestion, never to the page.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(list).getByRole("button", { name: "Accept PHY-02" }),
      );
    });
    const acceptedList = within(controls()).getByRole("list", { name: t.controls.acceptedLabel });
    expect(acceptedList.textContent).toContain("AST-01");
    expect(acceptedList.textContent).toContain("Accepted by Carl Ciso");

    decideControl.mockResolvedValueOnce(
      ok(
        riskDetail({ version: 4, controls: [accepted, control({ id: ID_B, status: "rejected" })] }),
      ),
    );
    await userEvent.type(
      within(list).getByLabelText("Your reason for PHY-02 (optional)"),
      "We have no secure areas",
    );
    await userEvent.click(within(list).getByRole("button", { name: "Reject PHY-02" }));
    expect(decideControl).toHaveBeenLastCalledWith(
      RISK_ID,
      ID_B,
      3,
      "reject",
      "We have no secure areas",
    );
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(t.controls.suggestedTitle);
    });
    expect(screen.getByTestId("risk-announcer").textContent).toBe("Rejected PHY-02.");
  });

  it("asks for suggestions, refreshes every 3 s while pending and announces when ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = riskDetail({ controlSuggestion: { status: "pending", failure: null } });
    requestControlSuggestions.mockResolvedValue(ok(pending));
    getRisk.mockResolvedValueOnce(ok(pending)).mockResolvedValueOnce(
      ok(
        riskDetail({
          controls: SUGGESTED,
          controlSuggestion: { status: "ready", failure: null },
        }),
      ),
    );
    detail(riskDetail());
    const button = within(controls()).getByRole("button", { name: t.controls.suggest });
    await userEvent.click(button);
    expect(requestControlSuggestions).toHaveBeenCalledWith(RISK_ID, 2);
    const status = within(controls()).getByTestId("suggestion-status");
    expect(status.getAttribute("role")).toBe("status");
    await waitFor(() => {
      expect(status.textContent).toBe(t.controls.finding);
    });
    // Focus stays on the button while it waits.
    expect(document.activeElement).toBe(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getRisk).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => {
      expect(status.textContent).toBe(t.controls.ready);
    });
    expect(within(controls()).getAllByRole("button", { name: /^Accept / })).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(getRisk).toHaveBeenCalledTimes(2);
  });

  it("stops refreshing after 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = riskDetail({ controlSuggestion: { status: "pending", failure: null } });
    getRisk.mockResolvedValue(ok(pending));
    detail(pending);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(63_000);
    });
    expect(getRisk).toHaveBeenCalledTimes(20);
    expect(within(controls()).getByTestId("suggestion-status").textContent).toBe(t.controls.slow);
  });

  it("explains in words when the AI is not available", async () => {
    requestControlSuggestions.mockResolvedValue(conflict("aiUnavailable.disabled"));
    detail(riskDetail());
    await userEvent.click(within(controls()).getByRole("button", { name: t.controls.suggest }));
    expect(await within(controls()).findByText(t.errors.aiUnavailable)).toBeTruthy();
  });

  it("searches the library and adds a control, keeping focus in the search", async () => {
    searchControls.mockResolvedValue(
      ok({
        libraryVersion: "1",
        items: [
          {
            code: "OPS-03",
            title: "Backups",
            category: "operations",
            frameworks: [],
            mappings: { total: 0, reviewed: 0 },
          },
          {
            code: "AST-01",
            title: "Asset inventory",
            category: "assets",
            frameworks: [],
            mappings: { total: 0, reviewed: 0 },
          },
        ],
      }),
    );
    addControl.mockResolvedValue(
      ok(
        riskDetail({
          version: 3,
          controls: [
            control({ status: "accepted", decidedBy: CARL }),
            control({
              id: ID_B,
              code: "OPS-03",
              title: "Backups",
              status: "accepted",
              source: "person",
            }),
          ],
        }),
      ),
    );
    detail(riskDetail({ controls: [control({ status: "accepted", decidedBy: CARL })] }));
    const search = within(controls()).getByLabelText(t.picker.label);
    await userEvent.type(search, "backup{Enter}");
    expect(searchControls).toHaveBeenCalledWith("backup");
    const results = await within(controls()).findByRole("list", { name: t.picker.resultsLabel });
    // A control already on the risk cannot be added twice.
    expect(within(results).queryByRole("button", { name: "Add AST-01" })).toBeNull();
    expect(results.textContent).toContain(t.picker.onRisk);
    await userEvent.click(within(results).getByRole("button", { name: "Add OPS-03" }));
    expect(addControl).toHaveBeenCalledWith(RISK_ID, 2, "OPS-03");
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
    expect(screen.getByTestId("risk-announcer").textContent).toBe("Added OPS-03.");
    const accepted = within(controls()).getByRole("list", { name: t.controls.acceptedLabel });
    expect(accepted.textContent).toContain("OPS-03");
  });

  it("removes an accepted control and moves focus to the accepted list", async () => {
    removeControl.mockResolvedValue(ok(riskDetail({ version: 3, controls: [] })));
    detail(riskDetail({ controls: [control({ id: ID_A, status: "accepted", decidedBy: CARL })] }));
    await userEvent.click(within(controls()).getByRole("button", { name: "Remove AST-01" }));
    expect(removeControl).toHaveBeenCalledWith(RISK_ID, ID_A, 2);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(t.controls.acceptedTitle);
    });
    expect(screen.getByTestId("risk-announcer").textContent).toBe("Removed AST-01.");
  });

  it("says plainly why a control with an open evidence request cannot be removed", async () => {
    removeControl.mockResolvedValue(conflict("controlHasOpenRequest"));
    detail(riskDetail({ controls: [control({ id: ID_A, status: "accepted", decidedBy: CARL })] }));
    await userEvent.click(within(controls()).getByRole("button", { name: "Remove AST-01" }));
    expect(
      await within(controls()).findByText(
        "Someone has an open evidence request for this control. It can be removed once the request is done.",
      ),
    ).toBeTruthy();
  });
});
