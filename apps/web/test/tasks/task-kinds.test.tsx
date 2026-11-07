// @vitest-environment jsdom
import type { MyTaskDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskList } from "../../components/evidence/task-list";
import en from "../../messages/index";
import { withMessages } from "../intl";

const completeTask = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  completeTask: (...a: unknown[]) => completeTask(...a) as unknown,
}));
vi.mock("../../components/evidence/upload-call", () => ({ sendUpload: vi.fn() }));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.tasks;
const task = (o: Partial<MyTaskDto> = {}): MyTaskDto => ({
  id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a",
  kind: "treatment_action",
  title: "Fit cable locks",
  description: "Fit locks to every laptop bay.",
  dueDate: "2026-11-20",
  status: "open",
  overdue: false,
  control: null,
  riskReference: "R-0001",
  riskTitle: "Laptops stolen from the office",
  riskId: null,
  completionNote: "",
  ...o,
});
const show = (tasks: MyTaskDto[], showRiskDetails = true) =>
  withMessages(
    <TaskList initial={tasks} evidenceMaxBytes={1000} showRiskDetails={showRiskDetails} />,
  );

beforeEach(() => {
  completeTask.mockReset();
});

describe("task kinds", () => {
  it("names each kind and shows description, due and overdue", () => {
    show([
      task({ id: "a", kind: "evidence_request", title: "Restore test" }),
      task({ id: "b", overdue: true }),
      task({ id: "c", kind: "periodic_review", title: "Review R-0001" }),
    ]);
    const items = within(screen.getByRole("list", { name: t.listLabel })).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Evidence request");
    expect(items[1]?.textContent).toContain("Action");
    expect(items[1]?.textContent).toContain("Fit locks to every laptop bay.");
    expect(items[1]?.textContent).toContain(t.overdue);
    expect(items[1]?.textContent).toContain("Due 20 November 2026");
    expect(items[2]?.textContent).toContain("Review this risk");
    // A review is named from its risk, never from the stored title.
    expect(within(items[2] as HTMLElement).getByRole("heading").textContent).toBe(
      "Review R-0001: Laptops stolen from the office",
    );
  });

  it("links the reference to the risk when the viewer may open it", () => {
    show([task({ riskId: "r-1" })]);
    expect(screen.getByRole("link", { name: "Risk R-0001" }).getAttribute("href")).toBe(
      "/risks/r-1",
    );
  });

  it("says how a done review was completed: its note, or by the approval", () => {
    show([
      task({ id: "a", kind: "periodic_review", status: "done", completionNote: "" }),
      task({ id: "b", kind: "periodic_review", status: "done", completionNote: "Still fine" }),
    ]);
    const items = within(screen.getByRole("list", { name: t.listLabel })).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain(t.completedByApproval);
    expect(items[1]?.textContent).toContain("Note: Still fine");
    expect(items[1]?.textContent).not.toContain(t.completedByApproval);
  });

  it("an action is marked done with a note; a review is not", async () => {
    completeTask.mockResolvedValue({ ok: true, data: {} });
    show([task(), task({ id: "r", kind: "periodic_review", title: "Review" })]);
    expect(screen.getAllByRole("button", { name: /Mark done/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /Mark done/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(t.noteLabel), "Fitted");
    await userEvent.click(within(dialog).getByRole("button", { name: t.doneSubmit }));
    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith(task().id, "Fitted");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /Mark done/ })).toBeNull();
    expect(screen.getByTestId("tasks-announcer").textContent).toContain("Fit cable locks");
  });

  it("a review links to the risk for a risk reader, else shows only the reference", () => {
    const review = task({ kind: "periodic_review", title: "Review" });
    const view = show([review], true);
    const link = screen.getByRole("link", { name: "Risks due for review" });
    expect(link.getAttribute("href")).toBe("/risks?filter=reviewDue");
    expect(screen.getByText("Risk R-0001")).toBeTruthy();
    view.unmount();
    show([review], false);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Risk R-0001")).toBeTruthy();
  });
});
