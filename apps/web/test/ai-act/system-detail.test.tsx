// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemDetail, type SystemDetailProps } from "../../components/ai-act/system-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, detail, highRisk, obligation, RISK_ID, SYSTEM_ID } from "./fixtures";

const updateAiObligation = vi.fn();
const suggestAiObligationSteps = vi.fn();
const linkAiSystemRisk = vi.fn();
const unlinkAiSystemRisk = vi.fn();
vi.mock("../../lib/actions/ai-act", () => ({
  updateAiObligation: (...args: unknown[]) => updateAiObligation(...args) as unknown,
  suggestAiObligationSteps: (...args: unknown[]) => suggestAiObligationSteps(...args) as unknown,
  linkAiSystemRisk: (...args: unknown[]) => linkAiSystemRisk(...args) as unknown,
  unlinkAiSystemRisk: (...args: unknown[]) => unlinkAiSystemRisk(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const o = en.aiAct.obligations;
const titles = en.aiActRules.obligationTitles;

function render(props: Partial<SystemDetailProps> = {}) {
  return withMessages(
    <SystemDetail
      initial={highRisk()}
      canManage
      canReadRisks
      riskOptions={[{ id: RISK_ID, reference: "R-0007", title: "Scoring bias against applicants" }]}
      timeZone="UTC"
      {...props}
    />,
  );
}

beforeEach(() => {
  updateAiObligation.mockReset();
  suggestAiObligationSteps.mockReset();
  linkAiSystemRisk.mockReset();
  unlinkAiSystemRisk.mockReset();
});

describe("SystemDetail", () => {
  it("shows the module badge, the class, its reasons as sentences and who classified it", () => {
    render();
    expect(screen.getByText(en.aiAct.moduleBadge)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Credit scoring engine" })).toBeTruthy();
    const section = screen.getByRole("region", { name: en.aiAct.classification.title });
    expect(within(section).getByText(en.aiActRules.reasons.annex_iii.profiling)).toBeTruthy();
    expect(within(section).getByText("Art. 6(3)")).toBeTruthy();
    expect(within(section).getByText(en.aiAct.classification.source.manual)).toBeTruthy();
    expect(within(section).getByText("Classified by Carl Ciso on 2 November 2026")).toBeTruthy();
    expect(
      within(section)
        .getByRole("link", { name: en.aiAct.classification.reclassify })
        .getAttribute("href"),
    ).toBe(`/ai-act/systems/${SYSTEM_ID}/classify`);
  });

  it("marks an AI-assisted classification with an AI label", () => {
    const system = highRisk();
    const classification = system.classification;
    if (!classification) throw new Error("fixture is classified");
    render({
      initial: { ...system, classification: { ...classification, source: "ai_assisted" } },
    });
    const section = screen.getByRole("region", { name: en.aiAct.classification.title });
    expect(within(section).getByText(en.aiAct.classification.source.ai_assisted)).toBeTruthy();
  });

  it("lists applicable obligations with plain descriptions; the others collapsed and kept", () => {
    render();
    const list = screen.getByRole("list", { name: o.title });
    const items = within(list)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(items).toEqual([titles.ai_literacy, titles.use_per_instructions]);
    expect(screen.getByText(en.aiActRules.obligationDescriptions.ai_literacy)).toBeTruthy();
    const group = screen.getByText("1 no longer applies").closest("details");
    expect(group?.open).toBe(false);
    expect(within(group as HTMLElement).getByText(titles.disclose_ai_interaction)).toBeTruthy();
    expect(within(group as HTMLElement).getByText("Banner added.")).toBeTruthy();
  });

  it("saves a status and a note together, sending only what changed", async () => {
    const user = userEvent.setup();
    const saved = highRisk({
      obligations: [
        obligation({ status: "in_progress", note: "Training booked.", updatedBy: CARL }),
      ],
    });
    updateAiObligation.mockResolvedValue({ ok: true, data: saved });
    render();
    const forTitle = `for ${titles.ai_literacy}`;
    await user.selectOptions(
      screen.getByRole("combobox", { name: `Status ${forTitle}` }),
      "in_progress",
    );
    await user.type(screen.getByRole("textbox", { name: `Note ${forTitle}` }), "Training booked.");
    await user.click(screen.getByRole("button", { name: `Save ${forTitle}` }));
    expect(updateAiObligation).toHaveBeenCalledWith(SYSTEM_ID, "ai_literacy", {
      status: "in_progress",
      note: "Training booked.",
    });
    expect(await screen.findByText(o.saved)).toBeTruthy();
    expect(screen.getByText("Last changed by Carl Ciso on 1 November 2026")).toBeTruthy();
  });

  it("offers AI steps only when the system allows it; Add to note fills the editor, unsaved", async () => {
    const user = userEvent.setup();
    const { unmount } = render();
    expect(
      screen.queryByRole("button", { name: new RegExp(o.suggest.replace(/[()]/g, "\\$&")) }),
    ).toBeNull();
    unmount();

    suggestAiObligationSteps.mockResolvedValue({
      ok: true,
      data: {
        steps: ["Name a trainer.", "Run a session.", "Keep the attendance list."],
        evidenceHint: "The attendance list.",
        interactionId: "x",
      },
    });
    render({ initial: highRisk({ canSuggestGuidance: true }) });
    const forTitle = `for ${titles.ai_literacy}`;
    await user.click(screen.getByRole("button", { name: `${o.suggest} ${forTitle}` }));
    expect(suggestAiObligationSteps).toHaveBeenCalledWith(SYSTEM_ID, "ai_literacy");
    const steps = await screen.findByRole("list", {
      name: `Suggested steps for ${titles.ai_literacy}`,
    });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(o.suggestBadge)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: o.addToNote }));
    const note = screen.getByRole<HTMLTextAreaElement>("textbox", { name: `Note ${forTitle}` });
    expect(note.value).toBe(
      "1. Name a trainer.\n2. Run a session.\n3. Keep the attendance list.\nEvidence: The attendance list.",
    );
    expect(document.activeElement).toBe(note);
    expect(updateAiObligation).not.toHaveBeenCalled();
  });

  it("shows obligations read-only to people who may not manage AI systems", () => {
    render({ canManage: false, riskOptions: null });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("link", { name: en.aiAct.detail.edit })).toBeNull();
    expect(screen.queryByRole("link", { name: en.aiAct.classification.reclassify })).toBeNull();
    expect(screen.getAllByText(o.noNote).length).toBeGreaterThan(0);
  });

  it("asks to classify an unclassified system and has no obligations yet", () => {
    render({ initial: detail() });
    expect(screen.getByText(en.aiAct.classification.none)).toBeTruthy();
    expect(screen.getByText(o.none)).toBeTruthy();
    expect(screen.getByRole("link", { name: en.aiAct.classification.classify })).toBeTruthy();
  });

  it("links a risk from the picker and unlinks it again", async () => {
    const user = userEvent.setup();
    const link = {
      id: RISK_ID,
      reference: "R-0007",
      title: "Scoring bias against applicants",
      state: "approved" as const,
      linkedAt: "2026-11-03T10:00:00.000Z",
      linkedBy: CARL,
    };
    linkAiSystemRisk.mockResolvedValue({ ok: true, data: highRisk({ risks: [link] }) });
    unlinkAiSystemRisk.mockResolvedValue({ ok: true, data: highRisk() });
    render();
    const section = screen.getByRole("region", { name: en.aiAct.risks.title });
    expect(within(section).getByText(en.aiAct.risks.none)).toBeTruthy();
    await user.type(
      within(section).getByRole("searchbox", { name: en.aiAct.risks.pickerLabel }),
      "bias",
    );
    await user.click(within(section).getByRole("button", { name: "Link R-0007" }));
    expect(linkAiSystemRisk).toHaveBeenCalledWith(SYSTEM_ID, RISK_ID);
    expect(await within(section).findByRole("link", { name: link.title })).toBeTruthy();
    await user.click(within(section).getByRole("button", { name: "Unlink R-0007" }));
    expect(unlinkAiSystemRisk).toHaveBeenCalledWith(SYSTEM_ID, RISK_ID);
    expect(await within(section).findByText(en.aiAct.risks.none)).toBeTruthy();
  });

  it("hides linked risks from people who may not read risks", () => {
    render({ canReadRisks: false, riskOptions: null });
    expect(screen.queryByRole("region", { name: en.aiAct.risks.title })).toBeNull();
  });
});
