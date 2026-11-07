// @vitest-environment jsdom
import type { RiskDetailDto, TreatmentActionDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, OLGA, RIGA, SCALE, conflict, control, ok, riskDetail } from "./fixtures";

const addTreatmentAction = vi.fn();
const completeTask = vi.fn();
const cancelTask = vi.fn();
const getRisk = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  addTreatmentAction: (...a: unknown[]) => addTreatmentAction(...a) as unknown,
  completeTask: (...a: unknown[]) => completeTask(...a) as unknown,
  cancelTask: (...a: unknown[]) => cancelTask(...a) as unknown,
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  closeRisk: vi.fn(),
  reassessRisk: vi.fn(),
  confirmReview: vi.fn(),
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
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.insights.plan;
const action = (o: Partial<TreatmentActionDto> = {}): TreatmentActionDto => ({
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  title: "Fit cable locks",
  description: "",
  assignee: OLGA,
  dueDate: "2026-12-01",
  status: "open",
  overdue: false,
  control: null,
  completedAt: null,
  completedBy: null,
  completionNote: "",
  cancelledReason: "",
  ...o,
});
const plan = (actions: TreatmentActionDto[], overdue = 0) => ({
  actions,
  open: actions.filter((a) => a.status === "open").length,
  done: actions.filter((a) => a.status === "done").length,
  overdue,
});
const withPlan = (p: RiskDetailDto["treatmentPlan"], c: Partial<RiskDetailDto["can"]> = {}) =>
  riskDetail({
    state: "approved",
    version: 4,
    treatmentPlan: p,
    controls: [control({ status: "accepted" })],
    can: { ...riskDetail().can, edit: false, planActions: true, ...c },
  });

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      people={[OLGA, CARL]}
      evidenceMaxBytes={1000}
      canSearchLibrary={false}
      timeZone="UTC"
    />,
  );
}
const planRegion = () => screen.getByRole("group", { name: en.insights.plan.title });

beforeEach(() => {
  for (const f of [addTreatmentAction, completeTask, cancelTask, getRisk]) f.mockReset();
});

describe("treatment plan", () => {
  it("is absent without actions or permission to plan", () => {
    detail(withPlan(plan([]), { planActions: false }));
    expect(screen.queryByRole("group", { name: t.title })).toBeNull();
  });

  it("says progress in words with a bar, and flags overdue", () => {
    const actions = [
      action({ id: "a", status: "done" }),
      action({ id: "b", status: "done" }),
      action({ id: "c", overdue: true, title: "Late one" }),
      action({ id: "d" }),
      action({ id: "e", status: "cancelled", cancelledReason: "No longer needed" }),
    ];
    detail(withPlan(plan(actions, 1)));
    const p = within(planRegion());
    expect(p.getByText("2 of 4 done, 1 overdue")).toBeTruthy();
    const bar = p.getByRole("progressbar", { name: t.progressLabel });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    const late = p.getAllByRole("listitem").find((li) => li.textContent.includes("Late one"));
    const row = late as HTMLElement;
    expect(within(row).getByText(t.overdue)).toBeTruthy();
    expect(within(row).getByText("Assigned to Olga Owner")).toBeTruthy();
    expect(within(row).getByText("Due 1 December 2026")).toBeTruthy();
  });

  it("lists the linked control and the status", () => {
    detail(withPlan(plan([action({ control: { code: "AST-01", title: "Asset inventory" } })])));
    const p = within(planRegion());
    expect(p.getByText("Control AST-01 · Asset inventory")).toBeTruthy();
    expect(p.getByText(t.status.open)).toBeTruthy();
  });

  it("add action needs a title, a person and a due date", async () => {
    detail(withPlan(plan([])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: t.add }));
    const dialog = await screen.findByRole("dialog", { name: t.form.title });
    await userEvent.click(within(dialog).getByRole("button", { name: t.form.submit }));
    expect(addTreatmentAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(t.form.titleRequired)).toBeTruthy();
    expect(within(dialog).getByText(t.form.assigneeRequired)).toBeTruthy();
    expect(within(dialog).getByText(t.form.dueRequired)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(t.form.actionTitle));
  });

  it("adds an action and shows the refreshed plan", async () => {
    addTreatmentAction.mockResolvedValue(ok(action()));
    getRisk.mockResolvedValue(ok(withPlan(plan([action({ title: "Fit cable locks" })]))));
    detail(withPlan(plan([])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: t.add }));
    const dialog = await screen.findByRole("dialog", { name: t.form.title });
    await userEvent.type(within(dialog).getByLabelText(t.form.actionTitle), "Fit cable locks");
    await userEvent.selectOptions(within(dialog).getByLabelText(t.form.assignee), OLGA.id);
    await userEvent.type(within(dialog).getByLabelText(t.form.dueDate), "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: t.form.submit }));
    await waitFor(() => {
      expect(addTreatmentAction).toHaveBeenCalledWith(riskDetail().id, {
        title: "Fit cable locks",
        description: "",
        assigneeId: OLGA.id,
        dueDate: "2026-12-01",
        controlId: null,
      });
    });
    expect((await within(planRegion()).findAllByText("Fit cable locks")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("explains a refused add", async () => {
    addTreatmentAction.mockResolvedValue(conflict("treatmentIsAccept"));
    detail(withPlan(plan([])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: t.add }));
    const dialog = await screen.findByRole("dialog", { name: t.form.title });
    await userEvent.type(within(dialog).getByLabelText(t.form.actionTitle), "X");
    await userEvent.selectOptions(within(dialog).getByLabelText(t.form.assignee), OLGA.id);
    await userEvent.type(within(dialog).getByLabelText(t.form.dueDate), "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: t.form.submit }));
    expect(await within(dialog).findByText(t.errors.treatmentIsAccept)).toBeTruthy();
  });

  it("puts a refused past due date on the field", async () => {
    addTreatmentAction.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "dueDate", message: "The due date cannot be in the past" }],
    });
    detail(withPlan(plan([])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: t.add }));
    const dialog = await screen.findByRole("dialog", { name: t.form.title });
    await userEvent.type(within(dialog).getByLabelText(t.form.actionTitle), "X");
    await userEvent.selectOptions(within(dialog).getByLabelText(t.form.assignee), OLGA.id);
    await userEvent.type(within(dialog).getByLabelText(t.form.dueDate), "2020-01-01");
    await userEvent.click(within(dialog).getByRole("button", { name: t.form.submit }));
    expect(await within(dialog).findByText(t.errors.dueDatePast)).toBeTruthy();
    const due = within(dialog).getByLabelText(t.form.dueDate);
    expect(due.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(due);
  });

  it("explains that only treatment actions complete here", async () => {
    completeTask.mockResolvedValue(conflict("invalidTransition"));
    detail(withPlan(plan([action()])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: /Mark done/ }));
    const dialog = await screen.findByRole("dialog", { name: t.doneDialog.title });
    await userEvent.click(within(dialog).getByRole("button", { name: t.doneDialog.submit }));
    expect(await within(dialog).findByText(t.errors.invalidTransition)).toBeTruthy();
  });

  it("returns focus to the plan heading when a dialog closes", async () => {
    detail(withPlan(plan([action()])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: t.add }));
    await screen.findByRole("dialog", { name: t.form.title });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: t.title }));
    });
    await userEvent.click(within(planRegion()).getByRole("button", { name: /Cancel action/ }));
    await screen.findByRole("dialog", { name: t.cancelDialog.title });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: t.title }));
    });
  });

  it("marks an action done with an optional note", async () => {
    completeTask.mockResolvedValue(ok({}));
    getRisk.mockResolvedValue(ok(withPlan(plan([action({ status: "done" })]))));
    detail(withPlan(plan([action()])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: /Mark done/ }));
    const dialog = await screen.findByRole("dialog", { name: t.doneDialog.title });
    await userEvent.type(within(dialog).getByLabelText(t.doneDialog.label), "Fitted");
    await userEvent.click(within(dialog).getByRole("button", { name: t.doneDialog.submit }));
    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith(action().id, "Fitted");
    });
  });

  it("cancelling needs a reason", async () => {
    cancelTask.mockResolvedValue(ok(action({ status: "cancelled" })));
    getRisk.mockResolvedValue(ok(withPlan(plan([action({ status: "cancelled" })]))));
    detail(withPlan(plan([action()])));
    await userEvent.click(within(planRegion()).getByRole("button", { name: /Cancel action/ }));
    const dialog = await screen.findByRole("dialog", { name: t.cancelDialog.title });
    await userEvent.click(within(dialog).getByRole("button", { name: t.cancelDialog.submit }));
    expect(cancelTask).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(t.cancelDialog.label), "Not needed");
    await userEvent.click(within(dialog).getByRole("button", { name: t.cancelDialog.submit }));
    await waitFor(() => {
      expect(cancelTask).toHaveBeenCalledWith(action().id, "Not needed");
    });
  });
});
