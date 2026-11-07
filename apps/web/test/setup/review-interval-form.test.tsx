// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewIntervalForm } from "../../components/setup/review-interval-form";
import en from "../../messages/index";
import { withMessages } from "../intl";

const saveReviewInterval = vi.fn();
vi.mock("../../lib/actions/setup", () => ({
  saveReviewInterval: (...args: unknown[]) => saveReviewInterval(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.setup.reviewInterval;

beforeEach(() => {
  saveReviewInterval.mockReset().mockResolvedValue({ ok: true, data: {} });
});

describe("ReviewIntervalForm", () => {
  it("shows the saved interval with plain help text", () => {
    withMessages(<ReviewIntervalForm months={12} />);
    expect(screen.getByLabelText<HTMLInputElement>(t.label).value).toBe("12");
    expect(t.hint).toBe(
      "Approved and treated risks come back to their owner for review after this long.",
    );
    expect(screen.getByText(t.hint)).toBeTruthy();
  });

  it("saves a whole number of months from 1 to 36", async () => {
    const user = userEvent.setup();
    withMessages(<ReviewIntervalForm months={12} />);
    await user.clear(screen.getByLabelText(t.label));
    await user.type(screen.getByLabelText(t.label), "6");
    await user.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => {
      expect(saveReviewInterval).toHaveBeenCalledWith(6);
    });
    expect(await screen.findByText(t.saved)).toBeTruthy();
  });

  it.each(["0", "37", "1.5", ""])("refuses %j with the message from the file", async (value) => {
    const user = userEvent.setup();
    withMessages(<ReviewIntervalForm months={12} />);
    await user.clear(screen.getByLabelText(t.label));
    if (value) await user.type(screen.getByLabelText(t.label), value);
    await user.click(screen.getByRole("button", { name: t.save }));
    expect(screen.getByText(t.errors.months)).toBeTruthy();
    expect(screen.getByLabelText(t.label).getAttribute("aria-invalid")).toBe("true");
    expect(saveReviewInterval).not.toHaveBeenCalled();
  });

  it("says when the earlier steps are not finished (409)", async () => {
    const user = userEvent.setup();
    saveReviewInterval.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "", message: "setupIncomplete.profile" }],
    });
    withMessages(<ReviewIntervalForm months={12} />);
    await user.click(screen.getByRole("button", { name: t.save }));
    expect((await screen.findByRole("alert")).textContent).toContain(t.errors.notAccepted);
  });
});
