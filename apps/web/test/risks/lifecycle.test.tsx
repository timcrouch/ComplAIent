// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, SCALE, conflict, ok, riskDetail } from "./fixtures";

const closeRisk = vi.fn();
const reassessRisk = vi.fn();
const confirmReview = vi.fn();
const getRisk = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  closeRisk: (...a: unknown[]) => closeRisk(...a) as unknown,
  reassessRisk: (...a: unknown[]) => reassessRisk(...a) as unknown,
  confirmReview: (...a: unknown[]) => confirmReview(...a) as unknown,
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  submitRisk: vi.fn(),
  approveRisk: vi.fn(),
  returnRisk: vi.fn(),
  updateRisk: vi.fn(),
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  searchControls: vi.fn(),
  requestEvidence: vi.fn(),
  addTreatmentAction: vi.fn(),
  completeTask: vi.fn(),
  cancelTask: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.insights.lifecycle;
const none = { edit: false, submit: false };
const can = (o: Partial<RiskDetailDto["can"]> = {}): RiskDetailDto["can"] => ({
  ...riskDetail().can,
  ...none,
  ...o,
});
const approved = (o: Partial<RiskDetailDto> = {}) =>
  riskDetail({
    state: "approved",
    version: 7,
    nextReviewDue: "2099-01-31",
    can: can({ close: true, reassess: true, confirmReview: true }),
    ...o,
  });

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
const section = () => screen.getByRole("region", { name: t.title });
const announcer = () => screen.getByTestId("risk-announcer");

beforeEach(() => {
  for (const f of [closeRisk, reassessRisk, confirmReview, getRisk]) f.mockReset();
});

describe("lifecycle section", () => {
  it("is not shown for a risk that is not approved or treated", () => {
    detail(riskDetail());
    expect(screen.queryByRole("region", { name: t.title })).toBeNull();
  });

  it("offers the buttons the can flags allow", () => {
    detail(approved());
    const s = within(section());
    expect(s.getByText("Next review due 31 January 2099")).toBeTruthy();
    for (const name of [t.close, t.confirm, t.reassess]) {
      expect(s.getByRole("button", { name })).toBeTruthy();
    }
    expect(s.queryByText(t.openActions)).toBeNull();
  });

  it("shows nothing to press for someone who cannot review", () => {
    detail(approved({ can: can() }));
    expect(within(section()).queryAllByRole("button")).toHaveLength(0);
  });

  it("says why it cannot be marked as treated while actions are open", () => {
    detail(
      approved({
        can: can({ close: false, reassess: true, confirmReview: true }),
        treatmentPlan: { actions: [], open: 2, done: 0, overdue: 0 },
      }),
    );
    const s = within(section());
    expect(s.queryByRole("button", { name: t.close })).toBeNull();
    expect(s.getByText(t.openActions)).toBeTruthy();
  });

  it("says the review is due when the API says so, whatever the client's clock", () => {
    const { unmount } = detail(approved({ nextReviewDue: "2020-01-31", reviewDue: true }));
    expect(within(section()).getByText("Due for review since 31 January 2020")).toBeTruthy();
    unmount();
    // A past date the API does not call due (it decides the UTC day) is shown as the next review.
    detail(approved({ nextReviewDue: "2020-01-31", reviewDue: false }));
    expect(within(section()).getByText("Next review due 31 January 2020")).toBeTruthy();
  });

  it("for a treated risk says who treated it and offers confirm and reassess", () => {
    detail(
      approved({
        state: "closed",
        closedAt: "2026-11-05T10:00:00.000Z",
        closedBy: CARL,
        can: can({ reassess: true, confirmReview: true }),
      }),
    );
    const s = within(section());
    expect(s.getByText("Marked as treated on 5 November 2026 by Carl Ciso.")).toBeTruthy();
    expect(s.getByText("Next review due 31 January 2099")).toBeTruthy();
    expect(s.queryByRole("button", { name: t.close })).toBeNull();
    expect(s.getByRole("button", { name: t.reassess })).toBeTruthy();
  });

  it("marking as treated asks for a note and sends it with the version", async () => {
    closeRisk.mockResolvedValue(
      ok(riskDetail({ state: "closed", version: 8, can: can({ reassess: true }) })),
    );
    detail(approved());
    await userEvent.click(within(section()).getByRole("button", { name: t.close }));
    const dialog = await screen.findByRole("dialog", { name: t.close_dialog.title });
    const field = within(dialog).getByLabelText(t.close_dialog.label);
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });

    await userEvent.click(within(dialog).getByRole("button", { name: t.close_dialog.submit }));
    expect(closeRisk).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en.insights.noteDialog.required)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");

    await userEvent.type(field, "All actions done");
    await userEvent.click(within(dialog).getByRole("button", { name: t.close_dialog.submit }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.close_dialog.done);
    });
    expect(closeRisk).toHaveBeenCalledWith(riskDetail().id, 7, "All actions done");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("confirming still accurate allows an empty note", async () => {
    confirmReview.mockResolvedValue(ok(approved({ version: 8, nextReviewDue: "2099-07-31" })));
    detail(approved());
    await userEvent.click(within(section()).getByRole("button", { name: t.confirm }));
    const dialog = await screen.findByRole("dialog", { name: t.confirm_dialog.title });
    await userEvent.click(within(dialog).getByRole("button", { name: t.confirm_dialog.submit }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.confirm_dialog.done);
    });
    expect(confirmReview).toHaveBeenCalledWith(riskDetail().id, 7, "");
    expect(within(section()).getByText("Next review due 31 July 2099")).toBeTruthy();
  });

  it("reassessing needs a reason", async () => {
    reassessRisk.mockResolvedValue(ok(riskDetail({ state: "proposed", version: 8 })));
    detail(approved());
    await userEvent.click(within(section()).getByRole("button", { name: t.reassess }));
    const dialog = await screen.findByRole("dialog", { name: t.reassess_dialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.reassess_dialog.label), "New laptops");
    await userEvent.click(within(dialog).getByRole("button", { name: t.reassess_dialog.submit }));
    await waitFor(() => {
      expect(reassessRisk).toHaveBeenCalledWith(riskDetail().id, 7, "New laptops");
    });
  });

  it("explains a refusal in the dialog and keeps it open", async () => {
    closeRisk.mockResolvedValue(conflict("openTreatmentActions"));
    detail(approved());
    await userEvent.click(within(section()).getByRole("button", { name: t.close }));
    const dialog = await screen.findByRole("dialog", { name: t.close_dialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.close_dialog.label), "Done");
    await userEvent.click(within(dialog).getByRole("button", { name: t.close_dialog.submit }));
    expect(await within(dialog).findByText(t.errors.openTreatmentActions)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("offers a reload when someone saved the risk first", async () => {
    closeRisk.mockResolvedValue(conflict("staleVersion"));
    getRisk.mockResolvedValue(ok(approved({ version: 9 })));
    detail(approved());
    await userEvent.click(within(section()).getByRole("button", { name: t.close }));
    const dialog = await screen.findByRole("dialog", { name: t.close_dialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.close_dialog.label), "Done");
    await userEvent.click(within(dialog).getByRole("button", { name: t.close_dialog.submit }));
    const alert = await within(dialog).findByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: en.risks.stale.reload }));
    await waitFor(() => {
      expect(getRisk).toHaveBeenCalled();
    });
  });
});
