// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportFlow } from "../../components/report/report-flow";
import en from "../../messages/index";
import { deferred, withMessages } from "../intl";
import {
  CONVERSATION_ID,
  FIRST,
  Q_AFFECTED,
  Q_SITE,
  SITES,
  conversation,
  reported,
  reporter,
} from "./fixtures";

const startConcern = vi.fn();
const replyToConcern = vi.fn();
const getConcern = vi.fn();
const submitConcern = vi.fn();
const reportRisk = vi.fn();
vi.mock("../../lib/actions/report", () => ({
  startConcern: (...a: unknown[]) => startConcern(...a) as unknown,
  replyToConcern: (...a: unknown[]) => replyToConcern(...a) as unknown,
  getConcern: (...a: unknown[]) => getConcern(...a) as unknown,
  submitConcern: (...a: unknown[]) => submitConcern(...a) as unknown,
  reportRisk: (...a: unknown[]) => reportRisk(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.report;
const unavailable = (extra: { path: string; message: string }[] = []) => ({
  ok: false,
  kind: "conflict",
  details: [{ path: "aiUnavailable.providerError", message: "aiUnavailable" }, ...extra],
});

function flow(props: Partial<Parameters<typeof ReportFlow>[0]> = {}) {
  return withMessages(<ReportFlow aiAvailable startInForm={false} sites={SITES} {...props} />);
}

async function say(text: string) {
  await userEvent.type(screen.getByLabelText(t.chat.composerLabel), text);
  await userEvent.click(screen.getByRole("button", { name: t.chat.send }));
}

const log = () => screen.getByRole("log");

beforeEach(() => {
  for (const fn of [startConcern, replyToConcern, getConcern, submitConcern, reportRisk]) {
    fn.mockReset();
  }
});

describe("ReportFlow conversation", () => {
  it("opens with the first prompt in a polite log", () => {
    flow();
    expect(log().getAttribute("aria-live")).toBe("polite");
    expect(within(log()).getByText(t.chat.firstPrompt)).toBeTruthy();
  });

  it("says plainly that the reporter is talking to an AI and that a person reviews everything", () => {
    flow();
    const notice = screen.getByTestId("ai-notice");
    expect(notice.textContent).toBe(en.report.chat.aiNotice);
    expect(en.report.chat.aiNotice).toMatch(/AI bot.*not a person/);
    expect(en.report.chat.aiNotice).toMatch(/a person reviews everything/);
    const avatar = screen.getByTestId("assistant-prompt").parentElement?.querySelector("img");
    expect(decodeURIComponent(avatar?.getAttribute("src") ?? "")).toContain(
      "/images/reporting/beacon-bot.png",
    );
    expect(avatar?.getAttribute("alt")).toBe("");
  });

  it("shows an announced typing indicator while the turn runs", async () => {
    const turn = deferred<unknown>();
    startConcern.mockReturnValue(turn.promise);
    flow();
    await say(FIRST);
    expect(within(log()).getByText(FIRST)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(t.chat.typing);
    turn.resolve({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE]),
    });
    await screen.findByText(Q_SITE.text);
    expect(screen.queryByText(t.chat.typing)).toBeNull();
  });

  it("Not sure chip sends notSure and is always offered", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE]),
    });
    flow();
    await say(FIRST);
    const answers = await screen.findByRole("group", {
      name: t.chat.answersLabel,
    });
    expect(
      within(answers)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Riga plant", "Munich office", t.chat.notSure]);

    // A question without chips still offers "Not sure".
    const noChips = { ...Q_AFFECTED, chips: [] };
    replyToConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE, reporter(3, t.chat.notSure, true), noChips]),
    });
    await userEvent.click(within(answers).getByRole("button", { name: t.chat.notSure }));
    expect(replyToConcern).toHaveBeenCalledWith(CONVERSATION_ID, t.chat.notSure, true);
    await screen.findByText(noChips.text);
    const next = screen.getByRole("group", { name: t.chat.answersLabel });
    expect(within(next).getByRole("button", { name: t.chat.notSure })).toBeTruthy();
  });

  it("a chip answers with its own words", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE]),
    });
    replyToConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE, reporter(3, "Riga plant"), Q_AFFECTED]),
    });
    flow();
    await say(FIRST);
    await userEvent.click(await screen.findByRole("button", { name: "Riga plant" }));
    expect(replyToConcern).toHaveBeenCalledWith(CONVERSATION_ID, "Riga plant", false);
    await screen.findByText(Q_AFFECTED.text);
  });

  it("a failed turn switches to the form prefilled with the reporter's words", async () => {
    const long = `${FIRST} overnight at the Riga plant car park, which happens almost every week`;
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, long), Q_SITE]),
    });
    replyToConcern.mockResolvedValue(unavailable());
    flow();
    await say(long);
    await screen.findByText(Q_SITE.text);
    await say("Riga plant");

    expect(await screen.findByText(t.form.fallback)).toBeTruthy();
    const title = screen.getByLabelText<HTMLInputElement>(t.form.titleLabel);
    expect(title.value).toBe(long.slice(0, 80).trim());
    expect(title.value.length).toBeLessThanOrEqual(80);
    const scenario = screen.getByLabelText<HTMLTextAreaElement>(t.form.scenarioLabel);
    expect(scenario.value).toBe(`${long}\nRiga plant`);
  });

  it("a failed first turn keeps the conversation and reports through it from the form", async () => {
    startConcern.mockResolvedValue(
      unavailable([{ path: "conversationId", message: CONVERSATION_ID }]),
    );
    submitConcern.mockResolvedValue({ ok: true, data: reported("R-0007") });
    flow();
    await say(FIRST);
    await screen.findByText(t.form.fallback);
    expect(screen.getByLabelText<HTMLInputElement>(t.form.titleLabel).value).toBe(FIRST);

    await userEvent.click(screen.getByRole("button", { name: t.form.next }));
    await userEvent.selectOptions(screen.getByLabelText(t.form.siteLabel), "Riga plant");
    await userEvent.click(screen.getByRole("button", { name: t.form.next }));
    await userEvent.click(screen.getByRole("button", { name: t.form.next }));
    await userEvent.type(screen.getByLabelText(t.form.threatLabel), "Theft");
    await userEvent.type(screen.getByLabelText(t.form.consequenceLabel), "Data is exposed");
    await userEvent.click(screen.getByRole("button", { name: t.form.next }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));

    await waitFor(() => {
      expect(submitConcern).toHaveBeenCalledTimes(1);
    });
    const [id, input] = submitConcern.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(CONVERSATION_ID);
    expect(input).toMatchObject({
      title: FIRST,
      scenario: FIRST,
      threat: "Theft",
      consequence: "Data is exposed",
      siteId: SITES[0]?.id,
    });
    expect(input).not.toHaveProperty("aiEstimate");
    expect(reportRisk).not.toHaveBeenCalled();
    expect(await screen.findByText("R-0007")).toBeTruthy();
  });

  it("re-reads the conversation when another turn wrote first", async () => {
    startConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE]),
    });
    replyToConcern.mockResolvedValue({
      ok: false,
      kind: "conflict",
      details: [{ path: "staleVersion", message: "staleVersion" }],
    });
    getConcern.mockResolvedValue({
      ok: true,
      data: conversation([reporter(1, FIRST), Q_SITE, reporter(3, "Riga plant"), Q_AFFECTED]),
    });
    flow();
    await say(FIRST);
    await screen.findByText(Q_SITE.text);
    await say("Riga plant");
    expect(await screen.findByText(Q_AFFECTED.text)).toBeTruthy();
    expect(getConcern).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(screen.queryByText(t.form.fallback)).toBeNull();
  });
});

describe("ReportFlow form", () => {
  it("is the form when AI is unavailable, and checks each step before moving on", async () => {
    reportRisk.mockResolvedValue({ ok: true, data: reported("R-0002") });
    flow({ aiAvailable: false });
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.queryByText(t.form.fallback)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t.form.next }));
    expect(screen.getByText(t.errors.titleRequired)).toBeTruthy();
    expect(screen.getByLabelText(t.form.titleLabel).getAttribute("aria-invalid")).toBe("true");
  });
});
