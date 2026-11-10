// @vitest-environment jsdom
import type { ConcernTranscriptDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskFilters } from "../../components/risks/risk-filters";
import { RiskQueue } from "../../components/risks/risk-queue";
import { Transcript } from "../../components/risks/transcript";
import { navItemsFor } from "../../components/shell/nav-items";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, ok, summary } from "./fixtures";

const listRisks = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  listRisks: (...a: unknown[]) => listRisks(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;
const SECOND = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

beforeEach(() => {
  listRisks.mockReset();
});

describe("Risk queue", () => {
  it("offers every list filter as a link and marks the current one", () => {
    withMessages(<RiskFilters current="toReview" />);
    const nav = screen.getByRole("navigation", { name: t.filters.label });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "All",
      "To review",
      "Awaiting my approval",
      "Above appetite",
      "Evidence missing",
      "Due for review",
      "Reported by me",
      "Owned by me",
    ]);
    const current = within(nav).getByRole("link", { name: "To review" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/risks?filter=toReview");
  });

  it("shows reference, title, state, score with appetite, owner and site in words", () => {
    withMessages(
      <RiskQueue
        filter="all"
        initial={{
          items: [
            summary({ score: 12, aboveAppetite: true, owner: CARL }),
            summary({ id: SECOND, reference: "R-0002", title: "Open window", siteName: null }),
          ],
          nextCursor: null,
        }}
        timeZone="UTC"
      />,
    );
    const rows = within(screen.getByRole("list", { name: t.queue.listLabel })).getAllByRole(
      "listitem",
    );
    const [first, second] = rows;
    if (!first || !second) throw new Error("rows");
    expect(within(first).getByRole("link", { name: "Laptops left in unlocked cars" })).toBeTruthy();
    expect(first.textContent).toContain("R-0001");
    expect(first.textContent).toContain(t.state.proposed);
    expect(first.textContent).toContain("Score 12");
    expect(first.textContent).toContain(t.score.aboveAppetite);
    expect(first.textContent).toContain("Owner: Carl Ciso");
    expect(first.textContent).toContain("Site: Riga plant");
    expect(second.textContent).toContain(t.score.unscored);
    expect(second.textContent).toContain(t.queue.noOwner);
    expect(second.textContent).toContain(t.queue.noSite);
    expect(screen.queryByRole("button", { name: t.queue.loadMore })).toBeNull();
  });

  it("carries the map cell when paging", async () => {
    listRisks.mockResolvedValue(ok({ items: [], nextCursor: null }));
    const cell = { likelihood: 4, impact: 4, basis: "residual" as const };
    withMessages(
      <RiskQueue
        filter="all"
        initial={{ items: [summary()], nextCursor: "c" }}
        timeZone="UTC"
        cell={cell}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t.queue.loadMore }));
    expect(listRisks).toHaveBeenCalledWith("all", "c", cell);
  });

  it("loads more by cursor, announces it and moves focus to the first new risk", async () => {
    listRisks.mockResolvedValue(
      ok({
        items: [summary({ id: SECOND, reference: "R-0002", title: "Open window" })],
        nextCursor: null,
      }),
    );
    withMessages(
      <RiskQueue
        filter="toReview"
        initial={{ items: [summary()], nextCursor: "cursor-1" }}
        timeZone="UTC"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t.queue.loadMore }));
    expect(listRisks).toHaveBeenCalledWith("toReview", "cursor-1");
    const link = await screen.findByRole("link", { name: "Open window" });
    await waitFor(() => {
      expect(document.activeElement).toBe(link);
    });
    expect(screen.getByRole("status").textContent).toBe("1 more risk loaded.");
    expect(screen.queryByRole("button", { name: t.queue.loadMore })).toBeNull();
  });
});

describe("Transcript", () => {
  it("is a read-only log with the AI's messages labelled", () => {
    const transcript: ConcernTranscriptDto = {
      id: "c",
      status: "submitted",
      messages: [
        { seq: 1, role: "reporter", text: "Laptops in cars", chips: [], notSure: false },
        { seq: 2, role: "assistant", text: "Which site?", chips: ["Riga plant"], notSure: false },
        { seq: 3, role: "reporter", text: "Not sure", chips: [], notSure: true },
      ],
    };
    withMessages(<Transcript transcript={transcript} />);
    const log = screen.getByRole("log", { name: t.transcript.logLabel });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.textContent).toContain("Laptops in cars");
    expect(
      within(log).getByText(t.transcript.assistant).closest("[data-slot=ai-badge]"),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Navigation", () => {
  it("shows Risks to people who can read risks", () => {
    expect(navItemsFor(["risks.report"]).map((i) => i.key)).not.toContain("risks");
    expect(
      navItemsFor(["risks.read", "risks.report", "library.read"]).map((i) => [i.key, i.href]),
    ).toEqual([
      ["home", "/"],
      ["report", "/report"],
      ["contribution", "/security-contribution"],
      ["tasks", "/tasks"],
      ["risks", "/risks"],
      ["library", "/library"],
    ]);
  });
});
