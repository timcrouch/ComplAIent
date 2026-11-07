// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportFlow } from "../../components/report/report-flow";
import en from "../../messages/index";
import { withMessages } from "../intl";
import {
  CONVERSATION_ID,
  FIRST,
  MUNICH,
  RIGA,
  SITES,
  assistant,
  conversation,
  draft,
  reported,
  reporter,
} from "./fixtures";

const startConcern = vi.fn();
const submitConcern = vi.fn();
vi.mock("../../lib/actions/report", () => ({
  startConcern: (...a: unknown[]) => startConcern(...a) as unknown,
  replyToConcern: vi.fn(),
  getConcern: vi.fn(),
  submitConcern: (...a: unknown[]) => submitConcern(...a) as unknown,
  reportRisk: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.report;

async function toSummary() {
  startConcern.mockResolvedValue({
    ok: true,
    data: conversation([reporter(1, FIRST), assistant(2, "")], {
      draft: draft(),
    }),
  });
  withMessages(<ReportFlow aiAvailable startInForm={false} sites={SITES} />);
  await userEvent.type(screen.getByLabelText(t.chat.composerLabel), FIRST);
  await userEvent.click(screen.getByRole("button", { name: t.chat.send }));
  return screen.findByRole("region", { name: t.summary.title });
}

beforeEach(() => {
  startConcern.mockReset();
  submitConcern.mockReset();
});

describe("Summary card", () => {
  it("shows the draft under plain labels, editable, with the AI's rough estimate", async () => {
    const card = await toSummary();
    expect(card.textContent).toContain("Here's what I understood");
    const title = within(card).getByLabelText<HTMLInputElement>(t.summary.titleLabel);
    expect(title.value).toBe(FIRST);
    for (const label of [
      t.summary.scenarioLabel,
      t.summary.threatLabel,
      t.summary.consequenceLabel,
      t.summary.safeguardsLabel,
      t.summary.siteLabel,
    ]) {
      expect(within(card).getByLabelText(label)).toBeTruthy();
    }
    expect(within(card).getByText(t.summary.assetsLabel)).toBeTruthy();
    expect(within(card).getByText(t.summary.toConfirmLabel)).toBeTruthy();
    expect(within(card).getByText("AI's rough estimate")).toBeTruthy();
    expect(within(card).getByLabelText<HTMLSelectElement>(t.summary.siteLabel).value).toBe(RIGA.id);
  });

  it("reports the checked draft without the AI estimate and shows the reference", async () => {
    submitConcern.mockResolvedValue({ ok: true, data: reported("R-0003") });
    const card = await toSummary();
    const title = within(card).getByLabelText(t.summary.titleLabel);
    await userEvent.clear(title);
    await userEvent.type(title, "Laptops in cars");
    await userEvent.type(within(card).getByLabelText(t.summary.consequenceLabel), "Data leaks");
    await userEvent.selectOptions(within(card).getByLabelText(t.summary.siteLabel), MUNICH.name);
    // The reporter may drop an item to confirm.
    await userEvent.click(within(card).getByRole("button", { name: "Remove thing to confirm 1" }));
    await userEvent.click(within(card).getByRole("button", { name: t.summary.submit }));

    await waitFor(() => {
      expect(submitConcern).toHaveBeenCalledTimes(1);
    });
    const [id, input] = submitConcern.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(CONVERSATION_ID);
    expect(input).toEqual({
      title: "Laptops in cars",
      scenario: draft().scenario,
      threat: draft().threat,
      consequence: "Data leaks",
      existingSafeguards: "",
      assets: [{ name: "A device", type: "device" }],
      siteId: MUNICH.id,
      departmentId: null,
      toConfirm: [],
    });
    const done = await screen.findByRole("heading", { name: t.done.title });
    expect(done).toBeTruthy();
    expect(screen.getByText("R-0003")).toBeTruthy();
    expect(screen.getByRole("link", { name: t.done.concernsLink }).getAttribute("href")).toBe(
      "/concerns",
    );
  });

  it("names a missing answer on its field instead of sending", async () => {
    const card = await toSummary();
    await userEvent.click(within(card).getByRole("button", { name: t.summary.submit }));
    expect(within(card).getByText(t.errors.consequenceRequired)).toBeTruthy();
    expect(
      within(card).getByLabelText(t.summary.consequenceLabel).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(submitConcern).not.toHaveBeenCalled();
  });
});
