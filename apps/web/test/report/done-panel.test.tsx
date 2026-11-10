// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DonePanel } from "../../components/report/done-panel";
import { CONCERN_RANK_CHANGED } from "../../components/rewards/concern-rank-event";
import en from "../../messages/index";
import { withMessages } from "../intl";

const getConcernReward = vi.fn();
vi.mock("../../lib/actions/report", () => ({
  getConcernReward: (...args: unknown[]) => getConcernReward(...args) as unknown,
}));

const riskId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function panel(overrides: Partial<Parameters<typeof DonePanel>[0]> = {}) {
  return withMessages(
    <DonePanel
      riskId={riskId}
      reference="R-0042"
      rewardsEnabled
      aiAvailable
      initialRank={null}
      onAnother={vi.fn()}
      {...overrides}
    />,
  );
}

const reward = (rank: "recruit" | "defender" = "recruit") => ({
  ok: true,
  data: {
    evaluation: {
      id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      riskId,
      status: "provisional",
      source: "ai",
      legitimacy: "confirmed",
    },
    contribution: { rank: { key: rank } },
  },
});

beforeEach(() => {
  getConcernReward.mockReset();
  sessionStorage.clear();
});

describe("concern submission recognition", () => {
  it("thanks the reporter with the themed signal animation without asserting legitimacy", () => {
    getConcernReward.mockResolvedValue({ ok: false, kind: "not-found", details: [] });
    panel({ aiAvailable: false });
    expect(screen.getByTestId("signal-acknowledgement")).toBeTruthy();
    expect(screen.getByText(en.report.done.rewardBody)).toBeTruthy();
    expect(en.report.done.rewardBody).toContain("no judgment has been made yet");
    expect(getConcernReward).not.toHaveBeenCalled();
  });

  it("keeps the ordinary confirmation when rewards are disabled", () => {
    panel({ rewardsEnabled: false });
    expect(screen.queryByTestId("signal-acknowledgement")).toBeNull();
    expect(screen.getByText(en.report.done.body)).toBeTruthy();
    expect(getConcernReward).not.toHaveBeenCalled();
  });

  it("reveals a newly earned AI rank once and announces it to the shell", async () => {
    getConcernReward.mockResolvedValue(reward());
    const changed = vi.fn();
    window.addEventListener(CONCERN_RANK_CHANGED, changed);
    panel();

    expect(await screen.findByTestId("rank-promotion")).toBeTruthy();
    expect(screen.getByText("You've advanced to Recruit")).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ rank: "recruit" });

    window.removeEventListener(CONCERN_RANK_CHANGED, changed);
  });

  it("does not celebrate when the AI evaluation leaves the rank unchanged", async () => {
    getConcernReward.mockResolvedValue(reward("defender"));
    panel({ initialRank: "defender" });
    await waitFor(() => {
      expect(getConcernReward).toHaveBeenCalledWith(riskId);
    });
    expect(screen.queryByTestId("rank-promotion")).toBeNull();
  });

  it("does not replay the same evaluation and rank in the browser session", async () => {
    const result = reward();
    sessionStorage.setItem(
      `complaient:rank-promotion:${result.data.evaluation.id}:recruit`,
      "shown",
    );
    getConcernReward.mockResolvedValue(result);
    panel();
    await waitFor(() => {
      expect(getConcernReward).toHaveBeenCalledWith(riskId);
    });
    expect(screen.queryByTestId("rank-promotion")).toBeNull();
  });
});
