// @vitest-environment jsdom
import type { OrganisationResponse, RiskScaleDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSummary } from "../components/setup/review-summary";
import en from "../messages/index";
import { withMessages } from "./intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const completeSetup = vi.fn();
vi.mock("../lib/actions/setup", () => ({
  completeSetup: (...args: unknown[]) => completeSetup(...args) as unknown,
}));
vi.mock("../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.setup.review;
const scale: RiskScaleDto = { version: 1, appetiteThreshold: 9, likelihood: [], impact: [] };
const done: OrganisationResponse = {
  profile: { name: "Northwind GmbH", description: "We move goods.", approximateHeadcount: 850 },
  sites: [{ id: "s1", name: "Riga plant", countryCode: "LV" }],
  departments: [{ id: "d1", name: "Production" }],
  frameworks: [
    {
      id: "f1",
      frameworkVersionId: "v1",
      frameworkVersionKey: "gdpr-2016",
      name: "GDPR",
      versionLabel: "2016/679",
      status: "confirmed",
      source: "manual",
      reasoning: null,
      confirmedBy: null,
      confirmedAt: null,
    },
  ],
  riskScale: scale,
  defaultRiskScale: { ...scale, version: null },
  reviewIntervalMonths: 12,
  setup: { completedAt: null, missing: [] },
};
const countries = [{ code: "LV", name: "Latvia" }];
const finish = () => screen.getByRole("button", { name: t.finish });

beforeEach(() => {
  push.mockReset();
  completeSetup.mockReset();
});

describe("ReviewSummary", () => {
  it("shows each step's saved values with a link to edit it", () => {
    withMessages(
      <ReviewSummary organisation={done} countries={countries} timeZone="Europe/Riga" />,
    );
    for (const text of [
      "Northwind GmbH",
      "About 850 people",
      "Riga plant",
      "Latvia",
      "Production",
      "GDPR 2016/679",
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeTruthy();
    }
    expect(screen.getByText(new RegExp(en.setup.riskAppetite.presets.balanced.label))).toBeTruthy();
    const edit = screen.getByRole("link", {
      name: t.editStep.replace("{step}", en.setup.frameworks.title),
    });
    expect(edit.getAttribute("href")).toBe("/setup/frameworks");
  });

  it("links each missing step and enables Finish only when nothing is missing", async () => {
    const missing: OrganisationResponse = {
      ...done,
      frameworks: [],
      riskScale: null,
      setup: { completedAt: null, missing: ["frameworks", "riskScale"] },
    };
    const { unmount } = withMessages(
      <ReviewSummary organisation={missing} countries={countries} timeZone="Europe/Riga" />,
    );
    const todo = screen.getByRole("list", { name: t.missingTitle });
    expect(
      within(todo)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      [en.setup.frameworks.title, "/setup/frameworks"],
      [en.setup.riskAppetite.title, "/setup/risk-appetite"],
    ]);
    expect(finish().getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(finish());
    expect(completeSetup).not.toHaveBeenCalled();
    unmount();

    withMessages(
      <ReviewSummary organisation={done} countries={countries} timeZone="Europe/Riga" />,
    );
    expect(screen.queryByRole("list", { name: t.missingTitle })).toBeNull();
    expect(finish().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("re-lists the missing steps from a 409 and goes home after finishing", async () => {
    completeSetup.mockResolvedValueOnce({
      ok: false,
      kind: "conflict",
      details: [{ path: "setupIncomplete.sites", message: "x" }],
    });
    withMessages(
      <ReviewSummary organisation={done} countries={countries} timeZone="Europe/Riga" />,
    );
    await userEvent.click(finish());
    const todo = await screen.findByRole("list", { name: t.missingTitle });
    expect(within(todo).getByRole("link").getAttribute("href")).toBe("/setup/sites");
    expect(screen.getByRole("alert").textContent).toBe(en.setup.errors.setupIncomplete);
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to Home with setup=done after finishing", async () => {
    completeSetup.mockResolvedValue({ ok: true, data: { completedAt: "2026-11-04T10:00:00Z" } });
    withMessages(
      <ReviewSummary organisation={done} countries={countries} timeZone="Europe/Riga" />,
    );
    await userEvent.click(finish());
    expect(completeSetup).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/?setup=done");
  });

  it("shows a finished setup as finished, with no Finish action, and keeps Edit", () => {
    const finished: OrganisationResponse = {
      ...done,
      setup: { completedAt: "2026-11-04T22:30:00.000Z", missing: [] },
    };
    withMessages(
      <ReviewSummary organisation={finished} countries={countries} timeZone="Europe/Riga" />,
    );
    // 22:30 UTC is already 5 November in Riga: the date is the viewer's own.
    expect(
      screen.getByText(t.finished.replace("{date}", "5 November 2026"), { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.finish })).toBeNull();
    expect(screen.queryByText(t.ready)).toBeNull();
    expect(screen.getByRole("link", { name: t.goHome }).getAttribute("href")).toBe("/");
    expect(
      screen
        .getByRole("link", { name: t.editStep.replace("{step}", en.setup.sites.title) })
        .getAttribute("href"),
    ).toBe("/setup/sites");
  });
});
