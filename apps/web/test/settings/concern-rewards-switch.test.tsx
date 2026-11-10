// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConcernRewardsSwitch } from "../../components/settings/concern-rewards-switch";
import en from "../../messages/index";
import { withMessages } from "../intl";

const updateConcernRewards = vi.fn();
vi.mock("../../lib/actions/concern-rewards", () => ({
  updateConcernRewards: (...args: unknown[]) => updateConcernRewards(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

beforeEach(() => updateConcernRewards.mockReset());

describe("ConcernRewardsSwitch", () => {
  it("explains that reporting remains available while rewards are off", () => {
    withMessages(<ConcernRewardsSwitch initialEnabled={false} />);
    expect(screen.getByText(en.settings.concernReporting.disabledExplanation)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("switch").checked).toBe(false);
  });

  it("enables rewards and announces the saved state", async () => {
    updateConcernRewards.mockResolvedValue({ ok: true, data: { enabled: true } });
    withMessages(<ConcernRewardsSwitch initialEnabled={false} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(updateConcernRewards).toHaveBeenCalledExactlyOnceWith({ enabled: true });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(en.settings.concernReporting.savedOn);
    });
    expect(screen.getByText(en.settings.concernReporting.enabledExplanation)).toBeTruthy();
  });
});
