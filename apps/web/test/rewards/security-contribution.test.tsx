// @vitest-environment jsdom
import type { SecurityContributionDto } from "@isms/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecurityContributionView } from "../../components/rewards/security-contribution-view";
import { withMessages } from "../intl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const contribution: SecurityContributionDto = {
  enabled: true,
  points: { total: 500, provisional: 0 },
  rank: {
    key: "defender",
    label: "Defender",
    minimumPoints: 250,
    next: { key: "protector", label: "Protector", minimumPoints: 750 },
  },
  badges: [
    {
      key: "high_impact",
      title: "High Impact",
      description: "Reported a confirmed major or critical concern.",
      image: "/images/concern-rewards/badges/high-impact.png",
      repeatable: true,
      count: 3,
      firstAwardedAt: "2026-01-01T00:00:00.000Z",
      lastAwardedAt: "2026-03-01T00:00:00.000Z",
    },
    {
      key: "sharp_eye",
      title: "Sharp Eye",
      description: "Reported five confirmed or plausible concerns.",
      image: "/images/concern-rewards/badges/sharp-eye.png",
      repeatable: false,
      count: 1,
      firstAwardedAt: "2026-03-01T00:00:00.000Z",
      lastAwardedAt: "2026-03-01T00:00:00.000Z",
    },
  ],
  recent: [],
};

describe("SecurityContributionView", () => {
  it("shows a count for repeatable badges without duplicating the badge card", () => {
    withMessages(<SecurityContributionView contribution={contribution} />);
    expect(screen.getByLabelText("Earned 3 times").textContent).toBe("×3");
    expect(screen.getAllByText("High Impact")).toHaveLength(1);
    expect(screen.queryByLabelText("Earned 1 time")).toBeNull();
  });
});
