// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoTools } from "../../components/setup/demo-tools";
import en from "../../messages/index";
import { deferred, withMessages } from "../intl";

const loadSampleData = vi.fn();
const resetEverything = vi.fn();
vi.mock("../../app/(app)/setup/demo-actions", () => ({
  loadSampleData: (...args: unknown[]) => loadSampleData(...args) as unknown,
  resetEverything: (...args: unknown[]) => resetEverything(...args) as unknown,
}));
const goTo = vi.fn();
vi.mock("../../lib/navigate", () => ({
  goTo: (href: string) => {
    goTo(href);
  },
}));

const t = en.setup.demo;
const NAME = "Isarwerk Finanz AG (sample)";

beforeEach(() => {
  loadSampleData.mockReset().mockResolvedValue({ ok: true, data: {} });
  resetEverything.mockReset().mockResolvedValue({ ok: true, data: {} });
  goTo.mockReset();
});

async function openLoad(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: t.load.button }));
  return screen.getByRole("dialog");
}

describe("DemoTools", () => {
  it("renders nothing when demo mode is off (no status)", () => {
    const { container } = withMessages(<DemoTools status={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows that demo mode is on and the two actions with the spec's copy", () => {
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    expect(screen.getByRole("heading", { name: t.title })).toBeTruthy();
    expect(screen.getByText(t.on)).toBeTruthy();
    expect(t.load.description).toBe(
      "Replace everything with a year of sample activity for Isarwerk Finanz AG (sample).",
    );
    expect(t.reset.description).toBe("Delete all data and settings and return to a fresh install.");
    expect(screen.getByText(t.load.description)).toBeTruthy();
    expect(screen.getByText(t.reset.description)).toBeTruthy();
  });

  it("lists the five deletions in the dialog", async () => {
    const user = userEvent.setup();
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    const dialog = await openLoad(user);
    const items = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "Risks",
      "Evidence files",
      "History and the audit trail",
      "Settings, including the AI provider key",
      "Everyone's sign-in",
    ]);
    expect(items).toEqual(t.dialog.deletes);
  });

  it("keeps the button disabled until the name matches exactly; a trailing space matches", async () => {
    const user = userEvent.setup();
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    const dialog = await openLoad(user);
    const field = within(dialog).getByLabelText(t.dialog.label.name);
    const confirm = within(dialog).getByRole("button", { name: t.load.confirm });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    await user.type(field, NAME.toLowerCase());
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    await user.clear(field);
    await user.type(field, `${NAME} `);
    expect(confirm.getAttribute("aria-disabled")).toBe("false");
  });

  it("expects RESET when there is no organisation, case-sensitively", async () => {
    const user = userEvent.setup();
    withMessages(<DemoTools status={{ enabled: true, organisationName: null }} />);
    await user.click(screen.getByRole("button", { name: t.reset.button }));
    const dialog = screen.getByRole("dialog");
    const field = within(dialog).getByLabelText(t.dialog.label.reset);
    const confirm = within(dialog).getByRole("button", { name: t.reset.confirm });
    await user.type(field, "reset");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    await user.clear(field);
    await user.type(field, "RESET");
    expect(confirm.getAttribute("aria-disabled")).toBe("false");
    await user.click(confirm);
    await waitFor(() => {
      expect(resetEverything).toHaveBeenCalledWith("RESET");
    });
  });

  it("shows the loading text with aria-busy while the request runs", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: true; data: object }>();
    loadSampleData.mockReturnValue(pending.promise);
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    const dialog = await openLoad(user);
    await user.type(within(dialog).getByLabelText(t.dialog.label.name), NAME);
    await user.click(within(dialog).getByRole("button", { name: t.load.confirm }));
    expect(t.loading).toBe("Loading sample data…");
    const busy = await screen.findByText(t.loading);
    expect(busy.closest("[aria-busy='true']")).toBeTruthy();
    pending.resolve({ ok: true, data: {} });
  });

  it("explains a confirmation mismatch from the server", async () => {
    const user = userEvent.setup();
    loadSampleData.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "confirmationMismatch", message: "x" }],
    });
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    const dialog = await openLoad(user);
    await user.type(within(dialog).getByLabelText(t.dialog.label.name), NAME);
    await user.click(within(dialog).getByRole("button", { name: t.load.confirm }));
    expect(await screen.findByText(t.errors.confirmationMismatch)).toBeTruthy();
  });

  it("asks to sign in again when recent sign-in is required, and goes to the step-up URL", async () => {
    const user = userEvent.setup();
    resetEverything.mockResolvedValue({
      ok: false,
      kind: "reauth",
      details: [],
      href: "/auth/login?step_up=1",
    });
    withMessages(<DemoTools status={{ enabled: true, organisationName: NAME }} />);
    await user.click(screen.getByRole("button", { name: t.reset.button }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(t.dialog.label.name), NAME);
    await user.click(within(dialog).getByRole("button", { name: t.reset.confirm }));
    expect(await screen.findByText(t.errors.recentAuth)).toBeTruthy();
    expect(goTo).toHaveBeenCalledWith("/auth/login?step_up=1");
  });
});
