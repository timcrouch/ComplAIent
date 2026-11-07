// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyForm } from "../../components/settings/key-form";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { aiSettings } from "./fixtures";

const saveAiKey = vi.fn();
const removeAiKey = vi.fn();
vi.mock("../../lib/actions/ai-settings", () => ({
  saveAiKey: (...args: unknown[]) => saveAiKey(...args) as unknown,
  removeAiKey: (...args: unknown[]) => removeAiKey(...args) as unknown,
}));
const assign = vi.fn();
vi.mock("../../lib/navigate", () => ({ goTo: (href: string) => assign(href) as unknown }));

const t = en.settings.ai.key;
const KEY = "sk-or-v1-e2e-0123456789abcdef-WXYZ";
const onSaved = vi.fn();

function form(settings = aiSettings()) {
  return withMessages(
    <KeyForm
      keyStatus={settings.key}
      secretsKeyConfigured={settings.secretsKeyConfigured}
      timeZone="Europe/Riga"
      onSaved={onSaved}
    />,
  );
}

beforeEach(() => {
  saveAiKey.mockReset();
  removeAiKey.mockReset();
  assign.mockReset();
  onSaved.mockReset();
});

describe("KeyForm", () => {
  it("shows last 4 characters, who and when, never a key value", async () => {
    const { container } = form();
    expect(
      screen.getByText("A key is set · ends in WXYZ · set by Anna Admin on 5 November 2026"),
    ).toBeTruthy();
    // No input holds a key until Replace is chosen, and then it starts empty.
    expect(container.querySelector("input")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t.replace }));
    const input = screen.getByLabelText<HTMLInputElement>(t.label);
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.value).toBe("");
  });

  it("saves the key, clears the field and keeps only the returned status", async () => {
    const empty = aiSettings({ key: { set: false } });
    saveAiKey.mockResolvedValue({ ok: true, data: aiSettings() });
    form(empty);
    expect(screen.getByText(t.none)).toBeTruthy();
    const input = screen.getByLabelText<HTMLInputElement>(t.label);
    await userEvent.type(input, KEY);
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    expect(saveAiKey).toHaveBeenCalledExactlyOnceWith(KEY);
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(aiSettings());
    });
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(t.saved);
  });

  it("explains a refused key on the field without showing it", async () => {
    saveAiKey.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "key", message: "too_small" }],
    });
    form(aiSettings({ key: { set: false } }));
    const input = screen.getByLabelText<HTMLInputElement>(t.label);
    await userEvent.type(input, "short-key");
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByText(t.invalid)).toBeTruthy();
  });

  it("goes to sign in again when saving needs a recent sign-in", async () => {
    const href = "/auth/login?returnTo=%2Fsettings%2Fai&stepUp=1";
    saveAiKey.mockResolvedValue({ ok: false, kind: "reauth", details: [], href });
    form(aiSettings({ key: { set: false } }));
    await userEvent.type(screen.getByLabelText(t.label), KEY);
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(href);
    });
  });

  it("removes the key only after confirming in a dialog", async () => {
    removeAiKey.mockResolvedValue({ ok: true, data: aiSettings({ key: { set: false } }) });
    form();
    await userEvent.click(screen.getByRole("button", { name: t.remove }));
    const dialog = await screen.findByRole("dialog", { name: t.confirmTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: t.confirmCancel }));
    expect(removeAiKey).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: t.remove }));
    const again = await screen.findByRole("dialog", { name: t.confirmTitle });
    await userEvent.click(within(again).getByRole("button", { name: t.confirmRemove }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(aiSettings({ key: { set: false } }));
    });
    expect(removeAiKey).toHaveBeenCalledOnce();
  });

  it("says plainly when the server has no secrets key or cannot read the saved key", () => {
    const base = aiSettings();
    if (!base.key.set) throw new Error("fixture");
    form(aiSettings({ key: { ...base.key, readable: false } }));
    expect(screen.getByText(en.settings.ai.errors.keyUnreadable)).toBeTruthy();
    form(aiSettings({ key: { set: false }, secretsKeyConfigured: false }));
    expect(screen.getByText(en.settings.ai.errors.secretsKeyMissing)).toBeTruthy();
  });
});
