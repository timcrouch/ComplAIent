// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, RISK_ID, SCALE, conflict, control, ok, riskDetail } from "./fixtures";

const updateRisk = vi.fn();
const getRisk = vi.fn();
const removeControl = vi.fn();
const requestControlSuggestions = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  updateRisk: (...a: unknown[]) => updateRisk(...a) as unknown,
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  requestControlSuggestions: (...a: unknown[]) => requestControlSuggestions(...a) as unknown,
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: (...a: unknown[]) => removeControl(...a) as unknown,
  searchControls: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;
const pending = { status: "pending" as const, failure: null };

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      evidenceMaxBytes={1000}
      canSearchLibrary={false}
      timeZone="UTC"
    />,
  );
}

const region = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  for (const fn of [updateRisk, getRisk, removeControl, requestControlSuggestions]) {
    fn.mockReset();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Fix round 1", () => {
  it("an open editor keeps the version it opened at while suggestions refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    detail(riskDetail({ controlSuggestion: pending }));
    const record = region(t.record.title);
    await userEvent.click(within(record).getByRole("button", { name: "Edit Title" }));
    // Someone else saved meanwhile; the poll reads version 5.
    getRisk.mockResolvedValue(
      ok(riskDetail({ title: "Changed elsewhere", version: 5, controlSuggestion: pending })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getRisk).toHaveBeenCalled();
    updateRisk.mockResolvedValue(conflict("staleVersion"));
    const title = within(record).getByLabelText(t.record.fields.title);
    await userEvent.clear(title);
    await userEvent.type(title, "Mine");
    await userEvent.click(within(record).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { title: "Mine" });
    expect((await screen.findByRole("alert")).textContent).toContain(t.stale.message);
  });

  it("after the 60 s limit it offers to check again, which restarts the refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getRisk.mockResolvedValue(ok(riskDetail({ controlSuggestion: pending })));
    detail(riskDetail({ controlSuggestion: pending }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(63_000);
    });
    const controls = region(t.controls.title);
    const status = within(controls).getByTestId("suggestion-status");
    expect(status.textContent).toBe(t.controls.slow);
    await userEvent.click(within(controls).getByRole("button", { name: t.controls.checkAgain }));
    expect(status.textContent).toBe(t.controls.finding);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(controls).getByRole("button", { name: t.controls.suggest }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getRisk).toHaveBeenCalledTimes(21);
  });

  it("asking again after the limit restarts the refresh too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const risk = riskDetail({ controlSuggestion: pending });
    getRisk.mockResolvedValue(ok(risk));
    requestControlSuggestions.mockResolvedValue(ok(risk));
    detail(risk);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(63_000);
    });
    const controls = region(t.controls.title);
    await userEvent.click(within(controls).getByRole("button", { name: t.controls.suggest }));
    expect(requestControlSuggestions).toHaveBeenCalled();
    await waitFor(() => {
      expect(within(controls).getByTestId("suggestion-status").textContent).toBe(
        t.controls.finding,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getRisk).toHaveBeenCalledTimes(21);
  });

  it("after Reload in the estimate panel focus goes to the estimate button", async () => {
    updateRisk.mockResolvedValue(conflict("staleVersion"));
    getRisk.mockResolvedValue(ok(riskDetail({ version: 5 })));
    detail(riskDetail());
    const assessment = region(t.assessment.title);
    await userEvent.click(within(assessment).getByRole("button", { name: t.assessment.ai.use }));
    const alert = await within(assessment).findByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: t.stale.reload }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(assessment).getByRole("button", { name: t.assessment.ai.use }),
      );
    });
  });

  it("a failed Reload says so in a status message", async () => {
    updateRisk.mockResolvedValue(conflict("staleVersion"));
    getRisk.mockResolvedValue({ ok: false, kind: "unavailable", details: [] });
    detail(riskDetail());
    const record = region(t.record.title);
    await userEvent.click(within(record).getByRole("button", { name: "Edit Title" }));
    await userEvent.type(within(record).getByLabelText(t.record.fields.title), "!");
    await userEvent.click(within(record).getByRole("button", { name: t.inline.save }));
    const alert = await screen.findByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: t.stale.reload }));
    const status = await within(alert).findByRole("status");
    expect(status.textContent).toBe(t.stale.reloadFailed);
  });

  it("after Remove, focus goes to the next removable control", async () => {
    const ids = [
      "0a000000-0000-4000-8000-000000000001",
      "0a000000-0000-4000-8000-000000000002",
      "0a000000-0000-4000-8000-000000000003",
      "0a000000-0000-4000-8000-000000000004",
      "0a000000-0000-4000-8000-000000000005",
    ];
    const accepted = ["AST-01", "AST-02", "AST-03", "AST-04", "AST-05"].map((code, i) =>
      control({
        id: ids[i] ?? "",
        code,
        status: "accepted",
        decidedBy: CARL,
        evidenceCount: code === "AST-02" ? 1 : 0,
      }),
    );
    removeControl.mockResolvedValue(
      ok(riskDetail({ version: 3, controls: accepted.filter((c) => c.code !== "AST-03") })),
    );
    detail(riskDetail({ controls: accepted }));
    const controls = region(t.controls.title);
    await userEvent.click(within(controls).getByRole("button", { name: "Remove AST-03" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(controls).getByRole("button", { name: "Remove AST-04" }),
      );
    });
  });
});
