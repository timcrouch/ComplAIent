// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MasterSwitch, PrivacySwitches } from "../../components/settings/privacy-switches";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { aiSettings } from "./fixtures";

const updateAiSettings = vi.fn();
vi.mock("../../lib/actions/ai-settings", () => ({
  updateAiSettings: (...args: unknown[]) => updateAiSettings(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.settings.ai.privacy;
const onSaved = vi.fn();

beforeEach(() => {
  updateAiSettings.mockReset();
  onSaved.mockReset();
});

describe("PrivacySwitches", () => {
  it("explains each switch and warns that AI is paused while a privacy switch is off", async () => {
    updateAiSettings.mockResolvedValue({ ok: true, data: aiSettings({ euOnly: false }) });
    const { unmount } = withMessages(<PrivacySwitches euOnly zeroRetention onSaved={onSaved} />);
    const eu = screen.getByRole("switch", { name: t.euOnly });
    expect(document.getElementById(eu.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Requests go only to AI providers hosted in the EU.",
    );
    const zdr = screen.getByRole("switch", { name: t.zeroRetention });
    expect(document.getElementById(zdr.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Providers must not store your prompts or answers.",
    );
    expect(screen.queryByText("AI is paused until both are on.")).toBeNull();

    await userEvent.click(eu);
    expect(updateAiSettings).toHaveBeenCalledExactlyOnceWith({ euOnly: false });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(aiSettings({ euOnly: false }));
    });
    // The page passes the saved settings back down.
    unmount();
    withMessages(<PrivacySwitches euOnly={false} zeroRetention onSaved={onSaved} />);
    expect(screen.getByText("AI is paused until both are on.")).toBeTruthy();
  });

  describe("when non-EU routing is allowed (development only)", () => {
    const dev = en.settings.ai.privacy;

    it("warns about processing outside the EU, not that AI is paused, while only EU-only is off", () => {
      withMessages(
        <PrivacySwitches euOnly={false} zeroRetention nonEuRoutingAllowed onSaved={onSaved} />,
      );
      expect(screen.getByText(dev.nonEuWarning)).toBeTruthy();
      expect(dev.nonEuWarning).toBe(
        "EU-only routing is off: requests may be processed outside the EU. Development only.",
      );
      expect(screen.queryByText(dev.paused)).toBeNull();
    });

    it("says AI is paused until zero data retention is on when that is off", () => {
      withMessages(
        <PrivacySwitches
          euOnly={false}
          zeroRetention={false}
          nonEuRoutingAllowed
          onSaved={onSaved}
        />,
      );
      expect(screen.getByText(dev.pausedZeroRetention)).toBeTruthy();
      expect(screen.queryByText(dev.nonEuWarning)).toBeNull();
    });

    it("shows no warning with both switches on", () => {
      withMessages(<PrivacySwitches euOnly zeroRetention nonEuRoutingAllowed onSaved={onSaved} />);
      expect(screen.queryByText(dev.nonEuWarning)).toBeNull();
      expect(screen.queryByText(dev.paused)).toBeNull();
    });
  });

  it("shows the warning while zero retention alone is off", () => {
    withMessages(<PrivacySwitches euOnly zeroRetention={false} onSaved={onSaved} />);
    expect(screen.getByRole<HTMLInputElement>("switch", { name: t.zeroRetention }).checked).toBe(
      false,
    );
    expect(screen.getByText("AI is paused until both are on.")).toBeTruthy();
  });
});

describe("MasterSwitch", () => {
  it("turns the AI assistant on and announces it", async () => {
    updateAiSettings.mockResolvedValue({ ok: true, data: aiSettings({ enabled: true }) });
    withMessages(<MasterSwitch enabled={false} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("switch", { name: en.settings.ai.master.label }));
    expect(updateAiSettings).toHaveBeenCalledExactlyOnceWith({ enabled: true });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(aiSettings({ enabled: true }));
    });
  });
});
