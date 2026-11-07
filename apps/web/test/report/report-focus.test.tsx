// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportFlow } from "../../components/report/report-flow";
import en from "../../messages/index";
import { deferred, withMessages } from "../intl";
import {
  FIRST,
  Q_AFFECTED,
  Q_SITE,
  SITES,
  assistant,
  conversation,
  draft,
  reported,
  reporter,
} from "./fixtures";

const startConcern = vi.fn();
const replyToConcern = vi.fn();
const submitConcern = vi.fn();
vi.mock("../../lib/actions/report", () => ({
  startConcern: (...a: unknown[]) => startConcern(...a) as unknown,
  replyToConcern: (...a: unknown[]) => replyToConcern(...a) as unknown,
  getConcern: vi.fn(),
  submitConcern: (...a: unknown[]) => submitConcern(...a) as unknown,
  reportRisk: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.report;

function flow() {
  return withMessages(<ReportFlow aiAvailable startInForm={false} sites={SITES} />);
}

async function say(text: string) {
  await userEvent.type(screen.getByLabelText(t.chat.composerLabel), text);
  await userEvent.click(screen.getByRole("button", { name: t.chat.send }));
}

const answers = () => screen.getByRole("group", { name: t.chat.answersLabel });

beforeEach(() => {
  for (const fn of [startConcern, replyToConcern, submitConcern]) fn.mockReset();
});

describe("ReportFlow focus", () => {
  it("moves focus to the new question's first chip after a reply and after a chip answer", async () => {
    startConcern.mockResolvedValue({ ok: true, data: conversation([reporter(1, FIRST), Q_SITE]) });
    replyToConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE, reporter(3, "Riga plant"), Q_AFFECTED]),
    });
    flow();
    await say(FIRST);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(answers()).getByRole("button", { name: "Riga plant" }),
      );
    });
    await userEvent.click(within(answers()).getByRole("button", { name: "Riga plant" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(answers()).getByRole("button", { name: "Customer data" }),
      );
    });
  });

  it("moves focus to the composer when the new question has no chips of its own", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), { ...Q_SITE, chips: [] }]),
    });
    flow();
    await say(FIRST);
    await screen.findByText(Q_SITE.text);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(t.chat.composerLabel));
    });
  });

  it("focuses the summary heading when the summary replaces the composer", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), assistant(2, "")], { draft: draft() }),
    });
    flow();
    await say(FIRST);
    const heading = await screen.findByRole("heading", { name: t.summary.title });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("focuses the composer after Report another concern", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), assistant(2, "")], {
        draft: draft({ consequence: "Data leaks" }),
      }),
    });
    submitConcern.mockResolvedValue({ ok: true, data: reported("R-0009") });
    flow();
    await say(FIRST);
    await userEvent.click(await screen.findByRole("button", { name: t.summary.submit }));
    await userEvent.click(await screen.findByRole("button", { name: t.done.another }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(t.chat.composerLabel));
    });
  });

  it("announces the switch to the form and describes the focused question with it", async () => {
    startConcern.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "aiUnavailable.providerError", message: "aiUnavailable" }],
    });
    flow();
    await say(FIRST);
    const status = await screen.findByText(t.form.fallback);
    expect(status.closest("[role=status]")).not.toBeNull();
    await waitFor(() => {
      const focused = document.activeElement as HTMLElement;
      const ids = (focused.getAttribute("aria-describedby") ?? "").split(" ");
      const described = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      expect(described).toContain(t.form.fallback);
    });
  });
});

describe("ReportFlow thread", () => {
  it("keeps the reporter's sent bubble when the stored copy arrives (announced once)", async () => {
    const turn = deferred<unknown>();
    startConcern.mockReturnValue(turn.promise);
    flow();
    await say(FIRST);
    const bubble = within(screen.getByRole("log")).getByText(FIRST);
    turn.resolve({ ok: true, data: conversation([reporter(1, FIRST), Q_SITE]) });
    await screen.findByText(Q_SITE.text);
    expect(bubble.isConnected).toBe(true);
  });

  it("offers each chip once and a single Not sure", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([
        reporter(1, FIRST),
        assistant(2, "Is anything already protecting against this?", ["Yes", "Yes", "Not sure"]),
      ]),
    });
    flow();
    await say(FIRST);
    await screen.findByText("Is anything already protecting against this?");
    expect(
      within(answers())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Yes", t.chat.notSure]);
  });

  it("labels the AI's questions and chips with an AI badge", async () => {
    startConcern.mockResolvedValue({ ok: true, data: conversation([reporter(1, FIRST), Q_SITE]) });
    flow();
    await say(FIRST);
    const question = await screen.findByTestId("assistant-question");
    const bubble = question.closest("[data-message]");
    expect(bubble?.querySelector("[data-slot=ai-badge]")?.textContent).toBe("AI assistant");
    expect(answers().querySelector("[data-slot=ai-badge]")?.textContent).toBe("Suggested by AI");
  });
});
