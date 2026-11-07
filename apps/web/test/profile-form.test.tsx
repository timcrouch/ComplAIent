// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileForm } from "../components/setup/profile-form";
import { consumeStepHeadingFocus } from "../lib/step-focus";
import en from "../messages/index";
import { deferred, MARK, marked, withMessages } from "./intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const saveProfile = vi.fn();
vi.mock("../lib/actions/setup", () => ({
  saveProfile: (...args: unknown[]) => saveProfile(...args) as unknown,
}));
const goTo = vi.fn();
vi.mock("../lib/navigate", () => ({ goTo: (href: string) => goTo(href) as unknown }));

const t = en.setup.organisation;
const initial = { name: "Acme", description: "We make things.", approximateHeadcount: 40 };
const ok = { ok: true, data: {} };

beforeEach(() => {
  push.mockReset();
  goTo.mockReset();
  saveProfile.mockReset().mockResolvedValue(ok);
});

describe("ProfileForm", () => {
  it("every label and hint comes from en.json", () => {
    withMessages(<ProfileForm initial={null} />, marked(en));
    for (const [label, hint] of [
      [t.name, t.nameHint],
      [t.description, t.descriptionHint],
      [t.headcount, t.headcountHint],
    ] as const) {
      const control = screen.getByLabelText(`${label}${MARK}`);
      const hintId = `${control.id}-hint`;
      expect(control.getAttribute("aria-describedby")).toBe(hintId);
      expect(document.getElementById(hintId)?.textContent).toBe(`${hint}${MARK}`);
    }
    expect(screen.getByRole("button", { name: `${en.setup.continue}${MARK}` })).toBeTruthy();
  });

  it("shows the API's field problem next to the field and marks it invalid", async () => {
    saveProfile.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "name", message: "x" }],
    });
    withMessages(<ProfileForm initial={initial} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    const name = screen.getByRole("textbox", { name: t.name });
    await waitFor(() => {
      expect(name.getAttribute("aria-invalid")).toBe("true");
    });
    const errorId = `${name.id}-error`;
    expect(name.getAttribute("aria-describedby")?.split(" ")).toContain(errorId);
    expect(document.getElementById(errorId)?.textContent).toBe(en.setup.errors.name);
    expect(screen.queryByText("x")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(consumeStepHeadingFocus()).toBe(false);
  });

  it("checks the answers before saving and never calls the API with invalid ones", async () => {
    withMessages(<ProfileForm initial={null} />);
    await userEvent.type(screen.getByRole("textbox", { name: t.headcount }), "lots");
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveProfile).not.toHaveBeenCalled();
    for (const [label, message] of [
      [t.name, en.setup.errors.name],
      [t.description, en.setup.errors.description],
      [t.headcount, en.setup.errors.headcount],
    ] as const) {
      const control = screen.getByRole("textbox", { name: label });
      expect(control.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(`${control.id}-error`)?.textContent).toBe(message);
    }
    expect(screen.queryByText(en.setup.errors.unavailable)).toBeNull();
  });

  it("submits trimmed values and goes to the sites step", async () => {
    withMessages(<ProfileForm initial={null} />);
    await userEvent.type(screen.getByRole("textbox", { name: t.name }), "  Acme GmbH  ");
    await userEvent.type(screen.getByRole("textbox", { name: t.description }), " We sell. ");
    await userEvent.type(screen.getByRole("textbox", { name: t.headcount }), " 120 ");
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveProfile).toHaveBeenCalledWith({
      name: "Acme GmbH",
      description: "We sell.",
      approximateHeadcount: 120,
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/setup/sites");
    });
    expect(consumeStepHeadingFocus()).toBe(true); // the next step starts at its heading
  });

  it("announces 'Saving…' while pending and 'Saved' after success", async () => {
    const pending = deferred<typeof ok>();
    saveProfile.mockReturnValue(pending.promise);
    withMessages(<ProfileForm initial={initial} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    const button = await screen.findByRole("button", { name: en.setup.saving });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(en.setup.saving);
    pending.resolve(ok);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(en.setup.saved);
    });
  });

  it("sends the user to sign in again when the session ended while saving", async () => {
    saveProfile.mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: "/auth/login?returnTo=%2Fsetup%2Forganisation",
    });
    withMessages(<ProfileForm initial={initial} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/auth/login?returnTo=%2Fsetup%2Forganisation");
    });
    expect(screen.queryByText(en.setup.errors.unavailable)).toBeNull();
  });

  it("says when saving is unavailable, without blaming the answers", async () => {
    saveProfile.mockResolvedValue({ ok: false, kind: "unavailable", details: [] });
    withMessages(<ProfileForm initial={initial} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(await screen.findByText(en.setup.errors.unavailable)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t.name }).hasAttribute("aria-invalid")).toBe(false);
  });
});
