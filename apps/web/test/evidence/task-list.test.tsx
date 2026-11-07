// @vitest-environment jsdom
import type { EvidenceDto, MyTaskDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskList } from "../../components/evidence/task-list";
import en from "../../messages/index";
import { withMessages } from "../intl";

const sendUpload = vi.fn();
vi.mock("../../components/evidence/upload-call", () => ({
  sendUpload: (...a: unknown[]) => sendUpload(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.tasks;

const task = (overrides: Partial<MyTaskDto> = {}): MyTaskDto => ({
  id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a",
  kind: "evidence_request",
  title: "Last restore test",
  description: "The report from the last restore test.",
  dueDate: "2026-11-20",
  status: "open",
  overdue: false,
  control: { code: "RES-01", title: "Back-ups you can restore" },
  riskReference: "R-0001",
  riskTitle: "Laptops stolen from the office",
  riskId: null,
  completionNote: "",
  ...overrides,
});

const evidence: EvidenceDto = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  fileName: "restore.pdf",
  sha256: "c".repeat(64),
  sizeBytes: 10,
  mimeType: "application/pdf",
  classification: "internal",
  uploadedBy: { id: "u", displayName: "Rita Reporter" },
  collectedAt: "2026-11-05T00:00:00.000Z",
  controls: [{ code: "RES-01", title: "Back-ups you can restore" }],
};

const list = (tasks: MyTaskDto[], showRiskDetails = true) =>
  withMessages(
    <TaskList initial={tasks} evidenceMaxBytes={1000} showRiskDetails={showRiskDetails} />,
  );

beforeEach(() => {
  sendUpload.mockReset();
});

describe("task list", () => {
  it("shows the task text and control, its due date, and whether it is overdue", () => {
    list([
      task(),
      task({ id: "b", title: "Old one", status: "done", dueDate: null }),
      task({ id: "c", title: "Late", overdue: true }),
    ]);
    const items = within(screen.getByRole("list", { name: t.listLabel })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const [open, done, late] = items as [HTMLElement, HTMLElement, HTMLElement];
    expect(open.textContent).toContain("Last restore test");
    expect(open.textContent).toContain("The report from the last restore test.");
    expect(open.textContent).toContain("RES-01");
    expect(open.textContent).toContain("Back-ups you can restore");
    expect(open.textContent).toContain("20 November 2026");
    expect(within(open).getByRole("button", { name: /Upload the file/ })).toBeTruthy();
    expect(done.textContent).toContain(t.status.done);
    expect(within(done).queryByRole("button")).toBeNull();
    expect(late.textContent).toContain(t.overdue);
  });

  it("shows a contributor only the task text, control title and due date", () => {
    list([task()], false);
    const item = within(screen.getByRole("list", { name: t.listLabel })).getByRole("listitem");
    expect(item.textContent).toContain("Last restore test");
    expect(item.textContent).toContain("The report from the last restore test.");
    expect(item.textContent).toContain("Back-ups you can restore");
    expect(item.textContent).toContain("20 November 2026");
    expect(item.textContent).not.toContain("RES-01");
    expect(item.textContent).not.toContain("R-0001");
  });

  it("shows the risk reference and control code to someone who may read risks", () => {
    list([task()]);
    const item = within(screen.getByRole("list", { name: t.listLabel })).getByRole("listitem");
    expect(item.textContent).toContain("R-0001");
    expect(item.textContent).toContain("RES-01");
  });

  it("says when there is nothing to do", () => {
    list([]);
    expect(screen.getByText(t.empty)).toBeTruthy();
  });

  it("uploads the requested file, which completes the task", async () => {
    const user = userEvent.setup();
    sendUpload.mockResolvedValue({ ok: true, data: evidence });
    list([task()]);
    await user.click(screen.getByRole("button", { name: /Upload the file/ }));
    const dialog = await screen.findByRole("dialog");
    // A task names its control already: there is nothing to choose.
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    await user.upload(
      within(dialog).getByLabelText(en.evidence.uploadDialog.file),
      new File(["%PDF-1.7"], "restore.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: en.evidence.uploadDialog.submit }));
    await waitFor(() => {
      expect(screen.getByTestId("tasks-announcer").textContent).toBe(
        t.completed.replace("{title}", "Last restore test"),
      );
    });
    expect(sendUpload.mock.calls[0]?.[0]).toBe(`/tasks/${task().id}/evidence`);
    const item = within(screen.getByRole("list", { name: t.listLabel })).getByRole("listitem");
    expect(item.textContent).toContain(t.status.done);
    expect(within(item).queryByRole("button")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(item).getByRole("heading"));
    });
  });

  it("explains a task that was already closed", async () => {
    const user = userEvent.setup();
    sendUpload.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "taskClosed", message: "taskClosed" }],
    });
    list([task()]);
    await user.click(screen.getByRole("button", { name: /Upload the file/ }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(
      within(dialog).getByLabelText(en.evidence.uploadDialog.file),
      new File(["%PDF-1.7"], "restore.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: en.evidence.uploadDialog.submit }));
    expect(await within(dialog).findByText(en.evidence.errors.taskClosed)).toBeTruthy();
  });
});
