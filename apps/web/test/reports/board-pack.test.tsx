// @vitest-environment jsdom
import type { BoardPackResponse } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardPack } from "../../components/reports/board-pack";
import en from "../../messages/index";
import { deferred, withMessages } from "../intl";
import { PACK, SCALE } from "./board-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));
const draftNarrative = vi.fn();
const approveNarrative = vi.fn();
vi.mock("../../lib/actions/reports", () => ({
  draftNarrative: (...a: unknown[]) => draftNarrative(...a) as unknown,
  approveNarrative: (...a: unknown[]) => approveNarrative(...a) as unknown,
}));

const t = en.reports.board;
const INTERACTION = "5d3c8c1e-6b0a-4f4e-9a43-0f2b3a9d6c11";
const render = (over: Partial<BoardPackResponse> = {}) =>
  withMessages(<BoardPack pack={{ ...PACK, ...over }} scale={SCALE} timeZone="UTC" />);

const approved = {
  text: "Risks are stable.",
  approvedBy: "Anna Approver",
  approvedAt: "2026-10-05T09:00:00.000Z",
  aiAssisted: false,
};

beforeEach(() => {
  draftNarrative.mockReset();
  approveNarrative.mockReset();
});

describe("Board pack", () => {
  it("shows the period picker as links with the current one marked", () => {
    render();
    const nav = screen.getByRole("navigation", { name: t.periodLabel });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/reports/board?period=2026-Q3",
      "/reports/board?period=2026-Q2",
    ]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(links[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("shows the tiles, owners and top risks with action progress, in the new order", () => {
    render();
    const tiles = screen.getByRole("list", { name: t.tiles.title });
    expect(within(tiles).getByText(t.tiles.label.closed)).toBeTruthy();
    const list = screen.getByRole("list", { name: t.topRisks.title });
    expect(within(list).getByText(/RISK-0007/)).toBeTruthy();
    expect(within(list).getByText(/Data loss at site A/)).toBeTruthy();
    expect(within(list).getByText("1 of 3 actions done")).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      t.tiles.title,
      t.maps.title,
      t.movement.title,
      t.owners.title,
      t.topRisks.title,
      t.narrative.title,
    ]);
  });

  it("shows both maps and the movement chart with its table", () => {
    const { container } = render();
    expect(screen.getByRole("heading", { name: t.maps.now })).toBeTruthy();
    expect(screen.getByRole("heading", { name: t.maps.expected })).toBeTruthy();
    // Landmarks must be unique, so each map's region is named for its heading.
    for (const heading of [t.maps.now, t.maps.expected]) {
      expect(
        screen.getByRole("region", { name: `${en.insights.map.label}: ${heading}` }),
      ).toBeTruthy();
    }
    expect(screen.getByRole("img")).toBeTruthy();
    expect(container.querySelector("details table")).toBeTruthy();
  });

  it("shows map cells as text, not links, with one link to the risk map", () => {
    render();
    for (const heading of [t.maps.now, t.maps.expected]) {
      const region = screen.getByRole("region", { name: `${en.insights.map.label}: ${heading}` });
      expect(within(region).queryAllByRole("link")).toEqual([]);
      expect(within(region).getByText(/^Above appetite: 3 risks/)).toBeTruthy();
    }
    const open = screen.getByRole("link", { name: t.maps.open });
    expect(open.getAttribute("href")).toBe("/risks?view=map");
  });

  it("links to the PDF download for the period", () => {
    render();
    const link = screen.getByRole("link", { name: t.download });
    expect(link.getAttribute("href")).toBe("/reports/files/board.pdf?period=2026-Q3");
    // No `download` attribute: the proxy's plain-text errors must stay readable.
    expect(link.hasAttribute("download")).toBe(false);
  });

  it("without a narrative and without rights says none is approved yet", () => {
    render();
    expect(screen.getByText(t.narrative.none)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.narrative.draft })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("on the 1st, says last month only just ended rather than that nothing was approved (#8)", () => {
    const october = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
    render({ period: october, generatedAt: "2026-11-01T07:30:00.000Z" });
    expect(t.narrative.justEnded).toBe(
      "{period} ended yesterday, so no summary has been approved for it yet.",
    );
    expect(
      screen.getByText("October 2026 ended yesterday, so no summary has been approved for it yet."),
    ).toBeTruthy();
    expect(screen.queryByText(t.narrative.none)).toBeNull();
  });

  it("from the 2nd, or for the rolling 30 days, a missing summary is just not approved yet", () => {
    const october = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
    render({ period: october, generatedAt: "2026-11-02T00:00:00.000Z" });
    expect(screen.getByText(t.narrative.none)).toBeTruthy();
    const rolling = { key: "last-30-days", start: "2026-10-03", end: "2026-10-31" };
    render({ period: rolling, generatedAt: "2026-11-01T07:30:00.000Z" });
    expect(screen.getAllByText(t.narrative.none)).toHaveLength(2);
  });

  it("scoped readers are told the summary is for the whole organisation only", () => {
    render({ scope: { kind: "units", names: ["Riga"] } });
    expect(screen.getByText(t.narrative.scoped)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the approved narrative with who and when, and the AI note only when assisted", () => {
    const { unmount } = render({ narrative: approved });
    expect(screen.getByText("Risks are stable.")).toBeTruthy();
    expect(screen.getByText("Approved by Anna Approver on 5 October 2026")).toBeTruthy();
    expect(screen.queryByText(t.narrative.aiAssisted)).toBeNull();
    unmount();
    render({ narrative: { ...approved, aiAssisted: true } });
    expect(screen.getByText(t.narrative.aiAssisted)).toBeTruthy();
  });

  describe("narrative editor", () => {
    it("drafts with AI into an editable textarea marked as an AI draft", async () => {
      draftNarrative.mockResolvedValue({
        ok: true,
        data: { text: "Draft text 17.", interactionId: INTERACTION },
      });
      render({ canDraftNarrative: true, canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.draft }));
      const box = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: t.narrative.label,
      });
      expect(draftNarrative).toHaveBeenCalledWith("2026-Q3");
      expect(box.value).toBe("Draft text 17.");
      expect(screen.getByText(t.narrative.aiBadge)).toBeTruthy();
      expect(screen.getByText(t.narrative.checkEverySentence)).toBeTruthy();
    });

    it("saves the draft with its interaction id, then shows it as approved with the AI note", async () => {
      draftNarrative.mockResolvedValue({
        ok: true,
        data: { text: "Draft text 17.", interactionId: INTERACTION },
      });
      approveNarrative.mockResolvedValue({
        ok: true,
        data: { ...approved, text: "Edited text 17.", aiAssisted: true },
      });
      render({ canDraftNarrative: true, canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.draft }));
      const box = await screen.findByRole("textbox", { name: t.narrative.label });
      await userEvent.clear(box);
      await userEvent.type(box, "Edited text 17.");
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      expect(approveNarrative).toHaveBeenCalledWith({
        period: "2026-Q3",
        text: "Edited text 17.",
        interactionId: INTERACTION,
      });
      expect(await screen.findByText(t.narrative.aiAssisted)).toBeTruthy();
      expect(screen.getByText("Edited text 17.")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("lets an approver write one by hand when AI is off, sending a null interaction", async () => {
      approveNarrative.mockResolvedValue({ ok: true, data: approved });
      render({ canDraftNarrative: false, canApproveNarrative: true });
      expect(screen.queryByRole("button", { name: t.narrative.draft })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      await userEvent.type(
        screen.getByRole("textbox", { name: t.narrative.label }),
        "Risks are stable.",
      );
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      expect(approveNarrative).toHaveBeenCalledWith({
        period: "2026-Q3",
        text: "Risks are stable.",
        interactionId: null,
      });
      expect(await screen.findByText(/Approved by Anna Approver/)).toBeTruthy();
      expect(screen.queryByText(t.narrative.aiAssisted)).toBeNull();
    });

    it("explains the number guard in plain words and keeps the text", async () => {
      approveNarrative.mockResolvedValue({
        ok: false,
        kind: "invalid",
        details: [{ path: "text", message: "figures not in the records" }],
      });
      render({ canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      await userEvent.type(screen.getByRole("textbox"), "We have 99 open risks.");
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      expect((await screen.findByRole("alert")).textContent).toBe(t.narrative.errors.figures);
      expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("We have 99 open risks.");
    });

    it("says in plain copy when the AI draft was unverifiable or the AI is unavailable", async () => {
      draftNarrative.mockResolvedValueOnce({
        ok: false,
        kind: "conflict",
        details: [{ path: "narrativeUnverifiable", message: "x" }],
      });
      render({ canDraftNarrative: true, canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.draft }));
      expect((await screen.findByRole("alert")).textContent).toBe(t.narrative.errors.unverifiable);
      draftNarrative.mockResolvedValueOnce({
        ok: false,
        kind: "conflict",
        details: [{ path: "aiUnavailable.notConfigured", message: "x" }],
      });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.draft }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe(t.narrative.errors.aiUnavailable);
      });
    });

    it("refuses an empty narrative without calling the API", async () => {
      render({ canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      expect((await screen.findByRole("alert")).textContent).toBe(t.narrative.errors.empty);
      expect(approveNarrative).not.toHaveBeenCalled();
    });

    it("announces the draft, focuses the textarea, and shows the replace hint", async () => {
      const gate = deferred<unknown>();
      draftNarrative.mockReturnValue(gate.promise);
      render({ canDraftNarrative: true, canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.draft }));
      expect(screen.getByRole("status").textContent).toBe(t.narrative.announce.drafting);
      gate.resolve({ ok: true, data: { text: "Draft 17.", interactionId: INTERACTION } });
      const box = await screen.findByRole("textbox", { name: t.narrative.label });
      await waitFor(() => {
        expect(document.activeElement).toBe(box);
      });
      expect(screen.getByRole("status").textContent).toBe(t.narrative.announce.ready);
      expect(screen.getByText(t.narrative.replaceHint)).toBeTruthy();
    });

    it("links the error to the textarea, next to it", async () => {
      approveNarrative.mockResolvedValue({
        ok: false,
        kind: "invalid",
        details: [{ path: "text", message: "figures not in the records" }],
      });
      render({ canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      const box = screen.getByRole("textbox");
      await userEvent.type(box, "We have 99 open risks.");
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      const alert = await screen.findByRole("alert");
      expect(box.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
      expect(box.nextElementSibling).toBe(alert);
    });

    it("focuses the approved text after saving", async () => {
      approveNarrative.mockResolvedValue({ ok: true, data: approved });
      render({ canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      await userEvent.type(screen.getByRole("textbox"), "Risks are stable.");
      await userEvent.click(screen.getByRole("button", { name: t.narrative.use }));
      const text = await screen.findByText("Risks are stable.");
      await waitFor(() => {
        expect(document.activeElement).toBe(text.parentElement);
      });
      expect(screen.getByRole("status").textContent).toBe(t.narrative.announce.saved);
    });

    it("returns focus to the opening button on cancel", async () => {
      render({ canApproveNarrative: true });
      await userEvent.click(screen.getByRole("button", { name: t.narrative.write }));
      await userEvent.click(screen.getByRole("button", { name: t.narrative.cancel }));
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: t.narrative.write }),
        );
      });
    });
  });
});
