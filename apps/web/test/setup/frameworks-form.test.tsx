// @vitest-environment jsdom
import type { FrameworkVersionDto, OrganisationFrameworkDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrameworksForm } from "../../components/setup/frameworks-form";
import { consumeStepHeadingFocus } from "../../lib/step-focus";
import en from "../../messages/index";
import { MARK, marked, withMessages } from "../intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const saveFrameworks = vi.fn();
const suggestFrameworks = vi.fn();
vi.mock("../../lib/actions/setup", () => ({
  saveFrameworks: (...args: unknown[]) => saveFrameworks(...args) as unknown,
  suggestFrameworks: (...args: unknown[]) => suggestFrameworks(...args) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const GDPR = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const ISO = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const NIS2 = "7a2b3c4d-5e6f-4a70-9b81-c2d3e4f5a6b7";
const version = (id: string, name: string, label: string, summary: string) =>
  ({
    id,
    key: `${name}-${label}`,
    frameworkKey: name,
    name,
    versionLabel: label,
    summary,
    requirementCount: 12,
  }) satisfies FrameworkVersionDto;
const frameworks = [
  version(GDPR, "GDPR", "2016/679", "EU rules for personal data."),
  version(ISO, "ISO/IEC 27001", "2022", "The international standard for an ISMS."),
  version(NIS2, "NIS2", "2022/2555", "EU rules for essential and important entities."),
];

const t = en.setup.frameworks;

beforeEach(() => {
  push.mockReset();
  saveFrameworks.mockReset().mockResolvedValue({ ok: true, data: { frameworks: [] } });
  suggestFrameworks.mockReset();
});

describe("FrameworksForm", () => {
  it("is a labelled checkbox group showing each framework's summary", () => {
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[]} />, marked(en));
    const group = screen.getByRole("group", { name: `${t.legend}${MARK}` });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    const gdpr = within(group).getByRole("checkbox", { name: /GDPR/ });
    expect(gdpr.closest("label")?.textContent).toContain("2016/679");
    const described = (gdpr.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("EU rules for personal data.");
    expect(screen.getByText(`${t.hint}${MARK}`)).toBeTruthy();
  });

  it("pre-checks only confirmed frameworks and never mentions AI", () => {
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[ISO]} />);
    const checked = screen
      .getAllByRole<HTMLInputElement>("checkbox")
      .filter((b) => b.checked)
      .map((b) => b.value);
    expect(checked).toEqual([ISO]);
    expect(screen.queryAllByText(/\bAI\b|suggest/)).toEqual([]);
  });

  it("asks for at least one framework, then saves the chosen ones and moves on", async () => {
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[]} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveFrameworks).not.toHaveBeenCalled();
    const first = screen.getAllByRole("checkbox")[0] as HTMLElement;
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(en.setup.errors.frameworks)).toBeTruthy();

    await userEvent.click(screen.getByRole("checkbox", { name: /GDPR/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /ISO/ }));
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveFrameworks).toHaveBeenCalledWith([GDPR, ISO]);
    expect(push).toHaveBeenCalledWith("/setup/risk-appetite");
    expect(consumeStepHeadingFocus()).toBe(true);
  });

  it("shows the frameworks message when the API refuses the choice", async () => {
    saveFrameworks.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "frameworkVersionIds.0", message: "Unknown framework" }],
    });
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[GDPR]} />);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(screen.getByText(en.setup.errors.frameworks)).toBeTruthy();
    expect(screen.queryByText("Unknown framework")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

const REASONING = "Suggested from your answers — please check.";
const row = (versionId: string, status: "suggested" | "confirmed", source: "ai" | "manual") =>
  ({
    id: `row-${versionId}`,
    frameworkVersionId: versionId,
    frameworkVersionKey: versionId,
    name: "x",
    versionLabel: "x",
    status,
    source,
    reasoning: source === "ai" ? REASONING : null,
    confirmedBy: null,
    confirmedAt: null,
  }) satisfies OrganisationFrameworkDto;
const s = en.setup.frameworks.suggest;
const suggestButton = () => screen.getByRole("button", { name: s.button });

describe("FrameworksForm with AI suggestions", () => {
  it("has no suggest button and no AI hint when AI is off", () => {
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[]} aiAvailable={false} />);
    expect(screen.queryByRole("button", { name: /suggest/i })).toBeNull();
    expect(screen.queryAllByText(/\bAI\b|suggest/i)).toEqual([]);
  });

  it("suggested frameworks are unchecked and labelled as AI suggestions with their reasoning", () => {
    withMessages(
      <FrameworksForm
        frameworks={frameworks}
        confirmedIds={[ISO]}
        suggestions={[{ frameworkVersionId: NIS2, reasoning: REASONING }]}
        aiAvailable
      />,
    );
    const nis2 = screen.getByRole<HTMLInputElement>("checkbox", { name: /NIS2/ });
    expect(nis2.checked).toBe(false);
    const card = nis2.closest("li") as HTMLElement;
    expect(within(card).getByText(s.badge).closest("[data-slot=ai-badge]")).toBeTruthy();
    expect(within(card).getByText(REASONING)).toBeTruthy();
    const described = (nis2.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.some((d) => d.includes(REASONING))).toBe(true);
    // Only the suggested one is labelled.
    const iso = screen.getByRole("checkbox", { name: /ISO/ }).closest("li") as HTMLElement;
    expect(within(iso).queryByText(s.badge)).toBeNull();
  });

  it("asks for suggestions, shows them unchecked and announces how many arrived", async () => {
    suggestFrameworks.mockResolvedValue({
      ok: true,
      data: { frameworks: [row(ISO, "confirmed", "manual"), row(NIS2, "suggested", "ai")] },
    });
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[ISO]} aiAvailable />);
    await userEvent.click(suggestButton());
    expect(suggestFrameworks).toHaveBeenCalledOnce();
    const status = screen.getByTestId("suggest-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("1 framework suggested. Check each one before you save.");
    const nis2 = screen.getByRole<HTMLInputElement>("checkbox", { name: /NIS2/ });
    expect(nis2.checked).toBe(false);
    expect(within(nis2.closest("li") as HTMLElement).getByText(REASONING)).toBeTruthy();
    expect(suggestButton()).toBe(document.activeElement);

    // Saving confirms the checked ones; the API dismisses the rest.
    await userEvent.click(nis2);
    await userEvent.click(screen.getByRole("button", { name: en.setup.continue }));
    expect(saveFrameworks).toHaveBeenCalledWith([ISO, NIS2]);
  });

  it("says so in words when there is nothing new to suggest", async () => {
    suggestFrameworks.mockResolvedValue({
      ok: true,
      data: { frameworks: [row(ISO, "confirmed", "manual")] },
    });
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[ISO]} aiAvailable />);
    await userEvent.click(suggestButton());
    expect(screen.getByTestId("suggest-status").textContent).toBe(s.noneNew);
  });

  it.each([
    ["aiUnavailable.disabled", s.unavailable],
    ["setupIncomplete.profile", s.profileFirst],
  ])("explains a %s refusal in words", async (path, message) => {
    suggestFrameworks.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path, message: "x" }],
    });
    withMessages(<FrameworksForm frameworks={frameworks} confirmedIds={[]} aiAvailable />);
    await userEvent.click(suggestButton());
    expect(screen.getByTestId("suggest-status").textContent).toBe(message);
    expect(screen.queryByText("x")).toBeNull();
  });
});
