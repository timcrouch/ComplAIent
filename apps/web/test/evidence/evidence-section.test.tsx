// @vitest-environment jsdom
import type { EvidenceDto, RiskDetailDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, RISK_ID, RITA, SCALE, control, ok, riskDetail } from "../risks/fixtures";

const getRisk = vi.fn();
const requestEvidence = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  requestEvidence: (...a: unknown[]) => requestEvidence(...a) as unknown,
  submitRisk: vi.fn(),
  approveRisk: vi.fn(),
  returnRisk: vi.fn(),
  updateRisk: vi.fn(),
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  searchControls: vi.fn(),
}));
const sendUpload = vi.fn();
vi.mock("../../components/evidence/upload-call", () => ({
  sendUpload: (...a: unknown[]) => sendUpload(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.evidence;
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const AST = control({ status: "accepted", decidedBy: CARL });
const RES = control({
  id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  controlId: "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
  code: "RES-01",
  title: "Back-ups you can restore",
  status: "accepted",
});
const SUGGESTED = control({ id: "x1", controlId: "x2", code: "ACC-02", status: "suggested" });

const file: EvidenceDto = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  fileName: "backup-test.pdf",
  sha256: SHA,
  sizeBytes: 2048,
  mimeType: "application/pdf",
  classification: "confidential",
  uploadedBy: CARL,
  collectedAt: "2026-11-01T00:00:00.000Z",
  controls: [{ code: "RES-01", title: "Back-ups you can restore" }],
};

const reviewer = (overrides: Partial<RiskDetailDto> = {}) =>
  riskDetail({
    controls: [AST, RES, SUGGESTED],
    can: { ...riskDetail().can, addEvidence: true },
    ...overrides,
  });

function detail(
  risk: RiskDetailDto,
  people: readonly { id: string; displayName: string }[] | null = [CARL, RITA],
) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      people={people}
      evidenceMaxBytes={1000}
      canSearchLibrary={false}
      timeZone="UTC"
    />,
  );
}

const section = () => screen.getByRole("region", { name: t.title });
const announcer = () => screen.getByTestId("risk-announcer");

beforeEach(() => {
  getRisk.mockReset();
  requestEvidence.mockReset();
  sendUpload.mockReset();
});

describe("evidence section", () => {
  it("lists each file with its name, SHA-256, uploader, date and controls", () => {
    detail(reviewer({ evidence: [file] }));
    const list = within(section()).getByRole("list", { name: t.listLabel });
    const [item] = [...list.children] as HTMLElement[];
    if (!item) throw new Error("no evidence item");
    expect(list.children).toHaveLength(1);
    const link = within(item).getByRole("link", { name: /backup-test\.pdf/ });
    expect(link.getAttribute("href")).toBe(`/evidence/${file.id}/download`);
    const hash = within(item).getByText(SHA);
    expect(hash.tagName).toBe("CODE");
    expect(hash.className).toContain("font-mono");
    expect(item.textContent).toContain("Carl Ciso");
    expect(item.textContent).toContain("1 November 2026");
    const supports = within(item).getByRole("list", { name: t.supportsLabel });
    expect(
      within(supports)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["RES-01 Back-ups you can restore"]);
    expect(item.textContent).toContain(t.classification.confidential);
    expect(within(item).getByRole("button", { name: `${t.copy} backup-test.pdf` })).toBeTruthy();
  });

  it("copies the SHA-256 and says so", async () => {
    const user = userEvent.setup();
    detail(reviewer({ evidence: [file] }));
    await user.click(within(section()).getByRole("button", { name: `${t.copy} backup-test.pdf` }));
    expect(await navigator.clipboard.readText()).toBe(SHA);
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.copied);
    });
  });

  it("offers upload and request only to a reviewer, and only with an accepted control", () => {
    const view = detail(riskDetail({ controls: [AST] }));
    expect(within(section()).queryByRole("button", { name: t.upload })).toBeNull();
    expect(within(section()).queryByRole("button", { name: t.request })).toBeNull();
    view.unmount();
    detail(reviewer({ controls: [SUGGESTED] }));
    expect(within(section()).queryByRole("button", { name: t.upload })).toBeNull();
    expect(within(section()).getByText(t.needsControl)).toBeTruthy();
  });

  it("uploads a file for the chosen accepted controls and shows it", async () => {
    const user = userEvent.setup();
    sendUpload.mockResolvedValue({ ok: true, data: file });
    getRisk.mockResolvedValue(ok(reviewer({ evidence: [file] })));
    detail(reviewer());
    const trigger = within(section()).getByRole("button", { name: t.upload });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: t.uploadDialog.title });
    // Only accepted controls can be chosen.
    expect(within(dialog).queryByRole("checkbox", { name: /ACC-02/ })).toBeNull();
    await user.upload(
      within(dialog).getByLabelText(t.uploadDialog.file),
      new File(["%PDF-1.7"], "backup-test.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("checkbox", { name: /RES-01/ }));
    await user.selectOptions(
      within(dialog).getByLabelText(t.uploadDialog.classification),
      "confidential",
    );
    await user.type(within(dialog).getByLabelText(t.uploadDialog.collectedAt), "2026-11-01");
    await user.click(within(dialog).getByRole("button", { name: t.uploadDialog.submit }));

    await waitFor(() => {
      expect(announcer().textContent).toBe(
        t.uploadDialog.done.replace("{name}", "backup-test.pdf"),
      );
    });
    const [url, form] = sendUpload.mock.calls[0] as [string, FormData];
    expect(url).toBe(`/risks/${RISK_ID}/evidence`);
    expect(form.getAll("controlIds")).toEqual([RES.controlId]);
    expect(form.get("classification")).toBe("confidential");
    expect(form.get("collectedAt")).toBe("2026-11-01");
    expect((form.get("file") as File).name).toBe("backup-test.pdf");
    // The file part comes last, so the server reads the fields first.
    expect([...form.keys()].at(-1)).toBe("file");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(section()).getByText(SHA)).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("checks the file and controls before sending, with errors linked to the fields", async () => {
    const user = userEvent.setup();
    detail(reviewer());
    await user.click(within(section()).getByRole("button", { name: t.upload }));
    const dialog = await screen.findByRole("dialog", { name: t.uploadDialog.title });
    await user.click(within(dialog).getByRole("button", { name: t.uploadDialog.submit }));
    const input = within(dialog).getByLabelText(t.uploadDialog.file);
    expect(within(dialog).getByText(t.errors.fileRequired)).toBeTruthy();
    expect(within(dialog).getByText(t.errors.controlsRequired)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);

    await user.upload(
      input,
      new File([new Uint8Array(1001)], "big.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: t.uploadDialog.submit }));
    expect(within(dialog).getByText(/larger than/)).toBeTruthy();
    expect(sendUpload).not.toHaveBeenCalled();
  });

  it("explains a refused upload in plain words", async () => {
    const user = userEvent.setup();
    sendUpload.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "file", message: "evidenceTypeNotAllowed" }],
    });
    detail(reviewer());
    await user.click(within(section()).getByRole("button", { name: t.upload }));
    const dialog = await screen.findByRole("dialog", { name: t.uploadDialog.title });
    await user.upload(
      within(dialog).getByLabelText(t.uploadDialog.file),
      new File(["MZ"], "report.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("checkbox", { name: /AST-01/ }));
    await user.click(within(dialog).getByRole("button", { name: t.uploadDialog.submit }));
    expect(await within(dialog).findByText(t.errors.typeNotAllowed)).toBeTruthy();
  });

  it("requests evidence from a person for an accepted control", async () => {
    const user = userEvent.setup();
    requestEvidence.mockResolvedValue(ok({ id: "task-1" }));
    getRisk.mockResolvedValue(ok(reviewer()));
    detail(reviewer());
    await user.click(within(section()).getByRole("button", { name: t.request }));
    const dialog = await screen.findByRole("dialog", { name: t.requestDialog.title });
    expect(within(dialog).getByText(t.requestDialog.description)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: t.requestDialog.submit }));
    expect(within(dialog).getByText(t.errors.personRequired)).toBeTruthy();
    expect(requestEvidence).not.toHaveBeenCalled();

    await user.selectOptions(within(dialog).getByLabelText(t.requestDialog.person), RITA.id);
    await user.selectOptions(within(dialog).getByLabelText(t.requestDialog.control), RES.controlId);
    await user.type(within(dialog).getByLabelText(t.requestDialog.taskTitle), "Last restore test");
    await user.type(within(dialog).getByLabelText(t.requestDialog.details), "The report");
    await user.type(within(dialog).getByLabelText(t.requestDialog.dueDate), "2026-11-20");
    await user.click(within(dialog).getByRole("button", { name: t.requestDialog.submit }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(
        t.requestDialog.done.replace("{name}", RITA.displayName),
      );
    });
    expect(requestEvidence).toHaveBeenCalledWith(RISK_ID, {
      assigneeId: RITA.id,
      controlId: RES.controlId,
      title: "Last restore test",
      description: "The report",
      dueDate: "2026-11-20",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no request without the people list", () => {
    detail(reviewer(), null);
    expect(within(section()).getByRole("button", { name: t.upload })).toBeTruthy();
    expect(within(section()).queryByRole("button", { name: t.request })).toBeNull();
  });
});
