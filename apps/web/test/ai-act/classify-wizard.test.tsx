// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassifyWizard } from "../../components/ai-act/classify-wizard";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { detail, highRisk, SYSTEM_ID } from "./fixtures";

const classifyAiSystem = vi.fn();
const draftAiClassification = vi.fn();
vi.mock("../../lib/actions/ai-act", () => ({
  classifyAiSystem: (...args: unknown[]) => classifyAiSystem(...args) as unknown,
  draftAiClassification: (...args: unknown[]) => draftAiClassification(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const w = en.aiAct.wizard;
const RATIONALE = "Suggested from the profile — please check.";

beforeEach(() => {
  classifyAiSystem.mockReset().mockResolvedValue({ ok: true, data: highRisk() });
  draftAiClassification.mockReset();
});

const next = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: w.next }));

describe("ClassifyWizard", () => {
  it("walks the six steps by hand, saves valid answers and shows the server's result", async () => {
    const user = userEvent.setup();
    withMessages(<ClassifyWizard system={detail()} canDraft={false} />);
    expect(screen.queryByRole("button", { name: w.draft })).toBeNull();
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();

    // An unanswered yes/no question stops the wizard and says so.
    await next(user);
    expect(screen.getByText(w.chooseOne)).toBeTruthy();
    await user.click(
      screen.getByRole("radio", { name: new RegExp(w.isAiSystem.yes.slice(0, 20)) }),
    );
    await next(user);
    expect(screen.getByRole("heading", { level: 2, name: w.steps.prohibited })).toBeTruthy();
    await next(user);
    await user.click(screen.getByRole("radio", { name: new RegExp(w.annexI.no.slice(0, 10)) }));
    await next(user);

    // The follow-ups appear only once an area is chosen; the fraud exclusion is in the help.
    expect(screen.queryByRole("group", { name: w.profilesPeople.question })).toBeNull();
    const credit = screen.getByRole("checkbox", { name: /Creditworthiness and credit scoring/ });
    expect(credit.closest("label")?.textContent).toMatch(/fraud/);
    await user.click(credit);
    const profiling = screen.getByRole("group", { name: w.profilesPeople.question });
    await user.click(within(profiling).getByRole("radio", { name: /^Yes/ }));
    const derogation = screen.getByRole("group", { name: w.derogation.question });
    await user.click(within(derogation).getByRole("radio", { name: /^None of these/ }));
    await next(user);
    await next(user);

    expect(screen.getByRole("heading", { level: 2, name: w.steps.review })).toBeTruthy();
    expect(screen.getByText("Creditworthiness and credit scoring")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: w.save }));
    expect(classifyAiSystem).toHaveBeenCalledWith(SYSTEM_ID, {
      answers: {
        isAiSystem: true,
        prohibitedPractices: [],
        annexISafetyComponent: false,
        annexIIIAreas: ["creditworthiness"],
        profilesPeople: true,
        derogation: "none",
        transparency: [],
      },
      interactionId: null,
    });
    const result = await screen.findByRole("heading", { level: 2, name: w.resultTitle });
    expect(document.activeElement).toBe(result);
    expect(screen.getByText(en.aiAct.classes.high_risk)).toBeTruthy();
    expect(screen.getByText(en.aiActRules.reasons.annex_iii.creditworthiness)).toBeTruthy();
    expect(screen.getByText("Annex III, point 5(b)")).toBeTruthy();
    expect(screen.getByText("2 obligations apply.")).toBeTruthy();
    expect(screen.getByRole("link", { name: w.done }).getAttribute("href")).toBe(
      `/ai-act/systems/${SYSTEM_ID}`,
    );
  });

  it("goes straight to the review when it is not an AI system", async () => {
    const user = userEvent.setup();
    withMessages(<ClassifyWizard system={detail()} canDraft={false} />);
    await user.click(screen.getByRole("radio", { name: new RegExp(w.isAiSystem.no.slice(0, 20)) }));
    await next(user);
    expect(screen.getByRole("heading", { level: 2, name: w.steps.review })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: w.save }));
    expect(classifyAiSystem.mock.calls[0]?.[1]).toMatchObject({
      answers: { isAiSystem: false, annexIIIAreas: [], profilesPeople: null, derogation: null },
    });
  });

  it("drafts every answer with AI, labels each rationale, and saves with the interaction", async () => {
    const user = userEvent.setup();
    draftAiClassification.mockResolvedValue({
      ok: true,
      data: {
        answers: {
          isAiSystem: true,
          prohibitedPractices: [],
          annexISafetyComponent: false,
          annexIIIAreas: ["creditworthiness"],
          profilesPeople: true,
          derogation: "none",
          transparency: [],
        },
        rationales: Object.fromEntries(
          [
            "isAiSystem",
            "prohibitedPractices",
            "annexISafetyComponent",
            "annexIIIAreas",
            "profilesPeople",
            "derogation",
            "transparency",
          ].map((k) => [k, RATIONALE]),
        ),
        interactionId: "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a00aa",
      },
    });
    withMessages(<ClassifyWizard system={detail({ canDraftClassification: true })} canDraft />);
    await user.click(screen.getByRole("button", { name: w.draft }));
    expect(draftAiClassification).toHaveBeenCalledWith(SYSTEM_ID);
    expect(await screen.findByText(w.draftNote)).toBeTruthy();
    expect(screen.getByText(w.rationaleBadge)).toBeTruthy();
    expect(screen.getByText(RATIONALE)).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: new RegExp(w.isAiSystem.yes.slice(0, 20)),
      }).checked,
    ).toBe(true);
    // Every step can be reached at once; the person still decides.
    await user.click(screen.getByRole("button", { name: /Review/ }));
    await user.click(screen.getByRole("button", { name: w.save }));
    expect(classifyAiSystem.mock.calls[0]?.[1]).toMatchObject({
      interactionId: "3f0c7f0e-8a5b-4d55-9b7c-2f1f6a7a00aa",
    });
  });

  it("says when the AI isn't available, and the questions still work", async () => {
    const user = userEvent.setup();
    draftAiClassification.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "aiUnavailable.disabled", message: "AI is off" }],
    });
    withMessages(<ClassifyWizard system={detail()} canDraft />);
    await user.click(screen.getByRole("button", { name: w.draft }));
    expect((await screen.findByRole("alert")).textContent).toBe(w.draftUnavailable);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("starts from the saved answers when reclassifying", () => {
    withMessages(<ClassifyWizard system={highRisk()} canDraft={false} />);
    expect(
      screen.getByRole<HTMLInputElement>("radio", {
        name: new RegExp(w.isAiSystem.yes.slice(0, 20)),
      }).checked,
    ).toBe(true);
  });
});
