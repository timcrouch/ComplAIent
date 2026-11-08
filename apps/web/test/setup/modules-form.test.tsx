// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModulesForm } from "../../components/setup/modules-form";
import en from "../../messages/index";
import { withMessages } from "../intl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const setModule = vi.fn();
vi.mock("../../lib/actions/setup", () => ({
  setModule: (...args: unknown[]) => setModule(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.aiAct.module;

beforeEach(() => {
  refresh.mockReset();
  setModule.mockReset();
});

describe("ModulesForm", () => {
  it("explains the EU AI Act module: what it is for, who needs it and who doesn't", () => {
    withMessages(<ModulesForm enabled={[]} />);
    const card = screen.getByRole("article", { name: t.name });
    expect(within(card).getByText(t.purpose)).toBeTruthy();
    expect(within(card).getByText(t.whoNeeds)).toBeTruthy();
    expect(t.whoNeeds).toMatch(/build, sell or use AI systems in the EU/);
    expect(within(card).getByText(t.whoDoesnt)).toBeTruthy();
    expect(screen.getByRole("switch", { name: t.switchLabel })).toMatchObject({ checked: false });
  });

  it("turns the module on at once and refreshes the navigation", async () => {
    const user = userEvent.setup();
    setModule.mockResolvedValue({ ok: true, data: { modules: ["eu_ai_act"] } });
    withMessages(<ModulesForm enabled={[]} />);
    await user.click(screen.getByRole("switch", { name: t.switchLabel }));
    expect(setModule).toHaveBeenCalledWith("eu_ai_act", true);
    expect(await screen.findByText(t.turnedOn)).toBeTruthy();
    expect(screen.getByRole("switch", { name: t.switchLabel })).toMatchObject({ checked: true });
    expect(screen.getByRole("link", { name: t.open }).getAttribute("href")).toBe("/ai-act");
    expect(refresh).toHaveBeenCalled();
  });

  it("asks before turning it off, says the data is kept, and can be cancelled", async () => {
    const user = userEvent.setup();
    withMessages(<ModulesForm enabled={["eu_ai_act"]} />);
    await user.click(screen.getByRole("switch", { name: t.switchLabel }));
    const dialog = screen.getByRole("dialog", { name: t.confirm.title });
    expect(within(dialog).getByText(t.confirm.kept)).toBeTruthy();
    // The close icon carries the same name, as in the demo dialogs; use the footer button.
    const cancel = within(dialog).getAllByRole("button", { name: t.confirm.cancel }).at(-1);
    await user.click(cancel as HTMLElement);
    expect(setModule).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: t.switchLabel })).toMatchObject({ checked: true });
  });

  it("turns it off after confirming", async () => {
    const user = userEvent.setup();
    setModule.mockResolvedValue({ ok: true, data: { modules: [] } });
    withMessages(<ModulesForm enabled={["eu_ai_act"]} />);
    await user.click(screen.getByRole("switch", { name: t.switchLabel }));
    await user.click(screen.getByRole("button", { name: t.confirm.confirm }));
    expect(setModule).toHaveBeenCalledWith("eu_ai_act", false);
    expect(await screen.findByText(t.turnedOff)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("switch", { name: t.switchLabel })).toMatchObject({ checked: false });
  });

  it("says when the change is refused", async () => {
    const user = userEvent.setup();
    setModule.mockResolvedValue({ ok: false, kind: "forbidden", details: [] });
    withMessages(<ModulesForm enabled={[]} />);
    await user.click(screen.getByRole("switch", { name: t.switchLabel }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.errors.forbidden);
  });
});
