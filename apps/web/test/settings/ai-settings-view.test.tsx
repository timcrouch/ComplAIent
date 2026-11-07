// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsView } from "../../components/settings/ai-settings-view";
import { purposeReadiness } from "../../components/settings/readiness";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { aiSettings, OFFERED } from "./fixtures";

const updateAiSettings = vi.fn();
vi.mock("../../lib/actions/ai-settings", () => ({
  updateAiSettings: (...args: unknown[]) => updateAiSettings(...args) as unknown,
  saveAiKey: vi.fn(),
  removeAiKey: vi.fn(),
  testAiConnection: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const r = en.settings.ai.readiness;
const m = en.settings.ai.models;

beforeEach(() => {
  updateAiSettings.mockReset();
});

describe("readiness", () => {
  it("is per purpose: a chosen model is ready while the others need one", () => {
    const settings = aiSettings({
      enabled: true,
      models: { conversation: "mock/isms-test", controls: null, frameworks: null },
      readiness: { ready: false, reason: "noModel" },
    });
    expect(purposeReadiness(settings)).toEqual([
      { purpose: "conversation", state: "ready" },
      { purpose: "controls", state: "noModel" },
      { purpose: "frameworks", state: "noModel" },
    ]);
    // Anything before the models (off, no key, privacy) holds every purpose back.
    expect(purposeReadiness(aiSettings()).map((p) => p.state)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("summarises readiness at the top in words with an icon, per purpose", () => {
    withMessages(
      <AiSettingsView
        settings={aiSettings({
          enabled: true,
          models: { conversation: "mock/isms-test", controls: null, frameworks: null },
          readiness: { ready: false, reason: "noModel" },
        })}
        offered={OFFERED}
        modelsUnavailable={null}
        timeZone="Europe/Riga"
      />,
    );
    const summary = screen.getByRole("region", { name: r.title });
    expect(within(summary).getByText(r.overall.noModel)).toBeTruthy();
    const list = within(summary).getByRole("list", { name: r.purposesLabel });
    const items = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "Conversation ready",
      "Control suggestions need a model",
      "Framework suggestions need a model",
    ]);
    expect(list.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(3);
  });
});

describe("ModelPickers", () => {
  it("offers one select per purpose from the listed models and saves all three", async () => {
    const saved = aiSettings({
      models: { conversation: "mock/isms-test", controls: "mock/other", frameworks: null },
    });
    updateAiSettings.mockResolvedValue({ ok: true, data: saved });
    withMessages(
      <AiSettingsView
        settings={aiSettings()}
        offered={OFFERED}
        modelsUnavailable={null}
        timeZone="Europe/Riga"
      />,
    );
    const conversation = screen.getByRole("combobox", {
      name: en.settings.ai.purposes.conversation,
    });
    const controls = screen.getByRole("combobox", { name: en.settings.ai.purposes.controls });
    expect(screen.getByRole("combobox", { name: en.settings.ai.purposes.frameworks })).toBeTruthy();
    expect(
      within(conversation)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([m.notChosen, "Test model", "Other model"]);
    await userEvent.selectOptions(conversation, "mock/isms-test");
    await userEvent.selectOptions(controls, "mock/other");
    await userEvent.click(screen.getByRole("button", { name: m.save }));
    expect(updateAiSettings).toHaveBeenCalledExactlyOnceWith({
      models: { conversation: "mock/isms-test", controls: "mock/other", frameworks: null },
    });
    await waitFor(() => {
      expect(screen.getByText(m.saved)).toBeTruthy();
    });
  });

  it("says only zero retention is missing when non-EU routing is allowed", () => {
    withMessages(
      <AiSettingsView
        settings={aiSettings({
          zeroRetention: false,
          nonEuRoutingAllowed: true,
          readiness: { ready: false, reason: "privacyOff" },
        })}
        offered={null}
        modelsUnavailable="privacyOff"
        timeZone="Europe/Riga"
      />,
    );
    expect(
      screen.getAllByText(en.settings.ai.readiness.overall.privacyOffZeroRetention).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(en.settings.ai.readiness.overall.privacyOff)).toBeNull();
  });

  it("explains why models cannot be chosen yet instead of empty selects", () => {
    withMessages(
      <AiSettingsView
        settings={aiSettings({ euOnly: false, readiness: { ready: false, reason: "privacyOff" } })}
        offered={null}
        modelsUnavailable="privacyOff"
        timeZone="Europe/Riga"
      />,
    );
    expect(screen.getByText(m.unavailable.privacyOff)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
