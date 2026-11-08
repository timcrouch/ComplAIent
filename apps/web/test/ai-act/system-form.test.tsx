// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemForm } from "../../components/ai-act/system-form";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, detail, SYSTEM_ID } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createAiSystem = vi.fn();
const updateAiSystem = vi.fn();
vi.mock("../../lib/actions/ai-act", () => ({
  createAiSystem: (...args: unknown[]) => createAiSystem(...args) as unknown,
  updateAiSystem: (...args: unknown[]) => updateAiSystem(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const f = en.aiAct.form;
const DEPT = { id: "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0009", name: "Lending" };
const OLGA = { id: "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a0010", displayName: "Olga Owner" };

beforeEach(() => {
  push.mockReset();
  createAiSystem.mockReset().mockResolvedValue({ ok: true, data: detail() });
  updateAiSystem.mockReset().mockResolvedValue({ ok: true, data: detail() });
});

function renderNew() {
  return withMessages(
    <SystemForm
      initial={null}
      people={[CARL, OLGA]}
      departments={[DEPT]}
      defaultOwnerId={CARL.id}
    />,
  );
}

describe("SystemForm", () => {
  it("adds a system with the profile as typed, then goes on to classify it", async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(screen.getByRole("textbox", { name: f.name }), "Credit scoring engine");
    await user.type(
      screen.getByRole("textbox", { name: f.intendedPurpose }),
      "Assess loan applicants.",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: f.owner }), OLGA.id);
    await user.selectOptions(screen.getByRole("combobox", { name: f.department }), DEPT.id);
    await user.click(screen.getByRole("checkbox", { name: new RegExp(f.usesGpai) }));
    await user.click(screen.getByRole("button", { name: f.create }));
    expect(createAiSystem).toHaveBeenCalledWith({
      name: "Credit scoring engine",
      description: "",
      intendedPurpose: "Assess loan applicants.",
      role: "deployer",
      status: "in_use",
      supplier: null,
      model: null,
      usesGeneralPurposeModel: true,
      ownerId: OLGA.id,
      departmentId: DEPT.id,
    });
    expect(push).toHaveBeenCalledWith(`/ai-act/systems/${SYSTEM_ID}/classify`);
  });

  it("marks missing fields and sends nothing", async () => {
    const user = userEvent.setup();
    renderNew();
    await user.click(screen.getByRole("button", { name: f.create }));
    expect(screen.getByRole("alert").textContent).toBe(f.errors.summary);
    expect(screen.getByText(f.errors.name)).toBeTruthy();
    expect(screen.getByText(f.errors.intendedPurpose)).toBeTruthy();
    expect(createAiSystem).not.toHaveBeenCalled();
  });

  it("puts a duplicate name on the name field", async () => {
    const user = userEvent.setup();
    createAiSystem.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "duplicateAiSystemName", message: "taken" }],
    });
    renderNew();
    await user.type(screen.getByRole("textbox", { name: f.name }), "Chatbot");
    await user.type(screen.getByRole("textbox", { name: f.intendedPurpose }), "Answer customers.");
    await user.click(screen.getByRole("button", { name: f.create }));
    expect(await screen.findByText(f.errors.duplicateName)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: f.name }).getAttribute("aria-invalid")).toBe("true");
  });

  it("edits an existing system and returns to it", async () => {
    const user = userEvent.setup();
    withMessages(
      <SystemForm initial={detail()} people={[]} departments={[]} defaultOwnerId={CARL.id} />,
    );
    // The current owner stays choosable without the people list.
    expect(screen.getByRole("option", { name: CARL.displayName })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: f.role }), "provider");
    await user.click(screen.getByRole("button", { name: f.save }));
    expect(updateAiSystem.mock.calls[0]?.[0]).toBe(SYSTEM_ID);
    expect(updateAiSystem.mock.calls[0]?.[1]).toMatchObject({ role: "provider", ownerId: CARL.id });
    expect(push).toHaveBeenCalledWith(`/ai-act/systems/${SYSTEM_ID}`);
  });
});
