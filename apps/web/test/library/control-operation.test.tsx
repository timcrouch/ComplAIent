// @vitest-environment jsdom
import type { ControlOperationDto, ControlTestDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlOperation } from "../../components/library/control-operation";
import en from "../../messages/index";
import { withMessages } from "../intl";

const recordControlTest = vi.fn();
const suggestTestSteps = vi.fn();
vi.mock("../../lib/actions/library", () => ({
  recordControlTest: (...args: unknown[]) => recordControlTest(...args) as unknown,
  suggestTestSteps: (...args: unknown[]) => suggestTestSteps(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.library.operation;
const FILE = "7b0f6f56-6a27-4e8e-9a43-0f2b3a9d6c11";

const test1: ControlTestDto = {
  id: "t1",
  testedOn: "2026-10-01",
  result: "partially_effective",
  method: "Restored last week's backup to a spare machine.",
  notes: "Took two attempts.",
  testedBy: { id: "u1", displayName: "Oscar Owner" },
  evidence: [{ id: FILE, fileName: "restore-log.pdf" }],
  hiddenEvidenceCount: 0,
};

const base: ControlOperationDto = {
  code: "RES-01",
  risks: [{ id: "r1", reference: "RISK-0007", title: "Data loss at site A", state: "approved" }],
  evidenceCount: 2,
  tests: [test1],
  latest: test1,
  testDue: false,
  canRecordTest: true,
  canSuggestSteps: false,
  evidenceOptions: [{ id: FILE, fileName: "restore-log.pdf", riskReference: "RISK-0007" }],
};
const render = (op: Partial<ControlOperationDto> = {}) =>
  withMessages(<ControlOperation operation={{ ...base, ...op }} timeZone="UTC" />);

beforeEach(() => {
  recordControlTest.mockReset().mockResolvedValue({ ok: true, data: test1 });
  suggestTestSteps.mockReset();
});

describe("ControlOperation panel", () => {
  it("lists the risks using the control as links, with the evidence count", () => {
    render();
    const section = screen.getByRole("region", { name: t.title });
    const link = within(section).getByRole("link", { name: /RISK-0007/ });
    expect(link.getAttribute("href")).toBe("/risks/r1");
    expect(within(section).getByText(/Data loss at site A/)).toBeTruthy();
    expect(within(section).getByText(/2 pieces of evidence/)).toBeTruthy();
  });

  it("says the latest result in words, and shows 'Test due' only when due", () => {
    const { unmount } = render();
    expect(screen.getAllByText(t.results.partially_effective).length).toBeGreaterThan(0);
    expect(screen.queryByText(t.testDue)).toBeNull();
    unmount();
    render({ testDue: true });
    expect(screen.getByText(t.testDue)).toBeTruthy();
  });

  it("says so when the control has never been tested, or is on no risk", () => {
    render({ latest: null, tests: [], risks: [], evidenceCount: 0 });
    expect(screen.getByText(t.neverTested)).toBeTruthy();
    expect(screen.getByText(t.noRisks)).toBeTruthy();
  });

  it("shows each test in its own details element", () => {
    const { container } = render();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.querySelector("summary")?.textContent).toContain("1 October 2026");
    expect(details?.textContent).toContain("Took two attempts.");
    expect(details?.textContent).toContain("restore-log.pdf");
    expect(details?.textContent).toContain("Oscar Owner");
  });

  it("lists each test's details as quiet labels (dt) beside the values (dd)", () => {
    const { container, unmount } = render();
    const details = container.querySelector("details");
    const terms = [...(details?.querySelectorAll("dl > div > dt") ?? [])].map((d) => d.textContent);
    expect(terms).toEqual([t.methodLabel, t.notesLabel, t.evidenceLabel]);
    const method = within(details as HTMLElement).getByText(t.methodLabel);
    expect(method.className).toContain("text-label");
    expect(method.nextElementSibling?.textContent).toBe(test1.method);
    unmount();
    const none = { ...test1, evidence: [], notes: "" };
    const again = render({ tests: [none], latest: none });
    const empty = within(again.container.querySelector("details") as HTMLElement).getByText(
      t.noEvidence,
    );
    expect(empty.getAttribute("data-empty")).toBe("true");
    expect(empty.closest("dd")).toBeTruthy();
  });

  it("counts the evidence the viewer may not see", () => {
    const hidden = { ...test1, hiddenEvidenceCount: 2 };
    const { container, unmount } = render({ tests: [hidden], latest: hidden });
    expect(container.querySelector("details")?.textContent).toContain(
      "restore-log.pdf+2 not visible to you",
    );
    unmount();
    const only = { ...test1, evidence: [], hiddenEvidenceCount: 1 };
    const again = render({ tests: [only], latest: only });
    const details = again.container.querySelector("details");
    expect(details?.textContent).toContain("+1 not visible to you");
    expect(details?.textContent).not.toContain(t.noEvidence);
  });

  it("hides the form when the viewer cannot record a test", () => {
    render({ canRecordTest: false });
    expect(screen.queryByRole("form", { name: t.form.title })).toBeNull();
    expect(screen.queryByRole("button", { name: t.form.submit })).toBeNull();
  });
});

describe("ControlOperation without data", () => {
  it("shows a small notice in the panel", () => {
    withMessages(<ControlOperation operation={null} timeZone="UTC" />);
    expect(screen.getByRole("region", { name: t.title })).toBeTruthy();
    expect(screen.getByText(t.loadFailed)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.form.submit })).toBeNull();
  });
});

describe("Record a test form", () => {
  it("clears 'Test recorded.' once the form is edited", async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole("radio", { name: t.results.effective }));
    await user.type(screen.getByLabelText(t.form.method), "x");
    await user.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.saved)).toBeTruthy();
    await user.type(screen.getByLabelText(t.form.method), "y");
    expect(screen.queryByText(t.form.saved)).toBeNull();
  });

  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.clear(screen.getByLabelText(t.form.testedOn));
    await user.type(screen.getByLabelText(t.form.testedOn), "2026-11-05");
    await user.click(screen.getByRole("radio", { name: t.results.effective }));
    await user.type(screen.getByLabelText(t.form.method), "Walked through the access list.");
  }

  it("offers date, a result radio group, method, notes and evidence checkboxes", () => {
    render();
    const group = screen.getByRole("group", { name: t.form.result });
    expect(
      within(group)
        .getAllByRole<HTMLInputElement>("radio")
        .map((r) => r.labels?.[0]?.textContent),
    ).toEqual([t.results.effective, t.results.partially_effective, t.results.ineffective]);
    expect(screen.getByLabelText(t.form.notes)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /restore-log\.pdf/ })).toBeTruthy();
  });

  it("explains each missing answer from the message file, and saves nothing", async () => {
    const user = userEvent.setup();
    render();
    await user.clear(screen.getByLabelText(t.form.testedOn));
    await user.click(screen.getByRole("button", { name: t.form.submit }));
    expect(screen.getByText(t.errors.testedOn)).toBeTruthy();
    expect(screen.getByText(t.errors.result)).toBeTruthy();
    expect(screen.getByText(t.errors.method)).toBeTruthy();
    expect(recordControlTest).not.toHaveBeenCalled();
  });

  it("records the test with the chosen evidence", async () => {
    const user = userEvent.setup();
    render();
    await fill(user);
    await user.type(screen.getByLabelText(t.form.notes), "All good.");
    await user.click(screen.getByRole("checkbox", { name: /restore-log\.pdf/ }));
    await user.click(screen.getByRole("button", { name: t.form.submit }));
    await waitFor(() => {
      expect(recordControlTest).toHaveBeenCalledWith("RES-01", {
        testedOn: "2026-11-05",
        result: "effective",
        method: "Walked through the access list.",
        notes: "All good.",
        evidenceIds: [FILE],
      });
    });
    expect(await screen.findByText(t.form.saved)).toBeTruthy();
  });

  it("places a server refusal of the date or evidence on its field", async () => {
    const user = userEvent.setup();
    recordControlTest.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "testedOn", message: "x" }],
    });
    render();
    await fill(user);
    await user.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.errors.testedOn)).toBeTruthy();
    expect(screen.getByLabelText(t.form.testedOn).getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a forbidden or unavailable save as a message, keeping the answers", async () => {
    const user = userEvent.setup();
    recordControlTest.mockResolvedValue({ ok: false, kind: "unavailable", details: [] });
    render();
    await fill(user);
    await user.click(screen.getByRole("button", { name: t.form.submit }));
    expect((await screen.findByRole("alert")).textContent).toContain(t.errors.unavailable);
    expect(screen.getByLabelText<HTMLTextAreaElement>(t.form.method).value).toContain(
      "Walked through",
    );
  });
});

describe("Suggest how to test", () => {
  const STEPS = ["Ask for the access list.", "Compare it with the leavers list.", "Note any gaps."];

  it("shows no button unless the AI can suggest steps", () => {
    render({ canSuggestSteps: false });
    expect(screen.queryByRole("button", { name: t.suggest.button })).toBeNull();
  });

  it("shows the steps as a numbered AI suggestion, then appends them to the method field", async () => {
    const user = userEvent.setup();
    suggestTestSteps.mockResolvedValue({ ok: true, data: { steps: STEPS, interactionId: "i1" } });
    render({ canSuggestSteps: true });
    await user.type(screen.getByLabelText(t.form.method), "Started the review.");
    await user.click(screen.getByRole("button", { name: t.suggest.button }));
    expect(suggestTestSteps).toHaveBeenCalledWith("RES-01");
    const list = await screen.findByRole("list", { name: t.suggest.listLabel });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(STEPS);
    expect(list.tagName).toBe("OL");
    expect(screen.getByText(t.suggest.badge)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.suggest.insert }));
    const method = screen.getByLabelText<HTMLTextAreaElement>(t.form.method);
    expect(method.value).toBe(
      "Started the review.\n1. Ask for the access list.\n2. Compare it with the leavers list.\n3. Note any gaps.",
    );
  });

  it("announces progress and focuses the method field after inserting", async () => {
    const user = userEvent.setup();
    suggestTestSteps.mockResolvedValue({ ok: true, data: { steps: STEPS, interactionId: "i1" } });
    render({ canSuggestSteps: true });
    await user.click(screen.getByRole("button", { name: t.suggest.button }));
    await screen.findByRole("list", { name: t.suggest.listLabel });
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain(
      t.suggest.announceDone,
    );
    await user.click(screen.getByRole("button", { name: t.suggest.insert }));
    expect(document.activeElement).toBe(screen.getByLabelText(t.form.method));
  });

  it("inserts into an empty field without a leading blank line", async () => {
    const user = userEvent.setup();
    suggestTestSteps.mockResolvedValue({ ok: true, data: { steps: STEPS, interactionId: "i1" } });
    render({ canSuggestSteps: true });
    await user.click(screen.getByRole("button", { name: t.suggest.button }));
    await user.click(await screen.findByRole("button", { name: t.suggest.insert }));
    expect(screen.getByLabelText<HTMLTextAreaElement>(t.form.method).value.startsWith("1. ")).toBe(
      true,
    );
  });

  it("says so in plain words when the AI can't help right now", async () => {
    const user = userEvent.setup();
    suggestTestSteps.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "aiUnavailable.notConfigured", message: "x" }],
    });
    render({ canSuggestSteps: true });
    await user.click(screen.getByRole("button", { name: t.suggest.button }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.suggest.unavailable);
    expect(screen.queryByRole("list", { name: t.suggest.listLabel })).toBeNull();
  });
});
