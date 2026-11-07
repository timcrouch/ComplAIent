// @vitest-environment jsdom
import type { MappingDto } from "@isms/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MappingRow } from "../components/library/mapping-row";
import en from "../messages/index";
import { deferred, withMessages } from "./intl";

const reviewMapping = vi.fn();
vi.mock("../lib/actions/library", () => ({
  reviewMapping: (...args: unknown[]) => reviewMapping(...args) as unknown,
}));
const goTo = vi.fn();
vi.mock("../lib/navigate", () => ({ goTo: (href: string) => goTo(href) as unknown }));

const t = en.library;

const mapping: MappingDto = {
  id: "3f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607",
  frameworkVersionKey: "iso27001-2022",
  frameworkName: "ISO/IEC 27001",
  versionLabel: "2022",
  requirementRef: "A.8.13",
  requirementTitle: "Recovery points exist, and restores work.",
  review: { status: "unreviewed" },
};

const reviewed: MappingDto = {
  ...mapping,
  review: {
    status: "reviewed",
    reviewedBy: { id: "u1", displayName: "Carl Ciso" },
    reviewedAt: "2026-11-04T22:30:00.000Z",
  },
};

const row = (m: MappingDto, canReview: boolean) =>
  withMessages(
    <ul>
      <MappingRow mapping={m} canReview={canReview} timeZone="Europe/Riga" />
    </ul>,
  );

beforeEach(() => {
  reviewMapping.mockReset();
  goTo.mockReset();
});

describe("MappingRow", () => {
  it("shows 'Not yet reviewed', and the button only with library.review", () => {
    const { unmount } = row(mapping, false);
    expect(screen.getByText("A.8.13")).toBeTruthy();
    expect(screen.getByText(mapping.requirementTitle)).toBeTruthy();
    const badge = screen.getByText(t.notReviewed).closest("[data-slot=status-badge]");
    expect(badge?.getAttribute("data-status")).toBe("attention");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    row(mapping, true);
    const button = screen.getByRole("button", { name: t.markReviewed });
    const describedBy = button.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toContain("A.8.13");
  });

  it("shows who reviewed a mapping and when, in the viewer's time zone", () => {
    row(reviewed, true);
    const badge = screen
      .getByText("Reviewed by Carl Ciso on 5 November 2026")
      .closest("[data-slot=status-badge]");
    expect(badge?.getAttribute("data-status")).toBe("ok");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("after marking, shows 'Reviewed by Carl Ciso on …' and announces it", async () => {
    const pending = deferred<unknown>();
    reviewMapping.mockReturnValue(pending.promise);
    row(mapping, true);
    await userEvent.click(screen.getByRole("button", { name: t.markReviewed }));
    expect(reviewMapping).toHaveBeenCalledWith(mapping.id);
    const busy = screen.getByRole("button", { name: t.marking });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(busy);
    expect(reviewMapping).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true, data: reviewed });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Reviewed by Carl Ciso on 5 November 2026",
      );
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(t.notReviewed)).toBeNull();
    // The button is gone, so focus moves to the new status rather than to the page.
    expect(document.activeElement?.textContent).toContain("Reviewed by Carl Ciso");
  });

  it.each([
    ["forbidden", t.reviewForbidden],
    ["not-found", t.reviewChanged],
    ["unavailable", t.reviewFailed],
    ["conflict", t.reviewFailed],
  ] as const)("explains a %s failure in plain words and keeps the button", async (kind, text) => {
    reviewMapping.mockResolvedValue({ ok: false, kind, details: [] });
    row(mapping, true);
    await userEvent.click(screen.getByRole("button", { name: t.markReviewed }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(screen.getByRole("button", { name: t.markReviewed })).toBeTruthy();
    expect(screen.getByText(t.notReviewed)).toBeTruthy();
  });

  it("recovers when the review request itself fails, so the button never sticks", async () => {
    reviewMapping.mockRejectedValue(new Error("network down"));
    row(mapping, true);
    await userEvent.click(screen.getByRole("button", { name: t.markReviewed }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.reviewFailed);
    const button = screen.getByRole<HTMLButtonElement>("button", { name: t.markReviewed });
    expect(button.disabled).toBe(false);
    expect(screen.getByText(t.notReviewed)).toBeTruthy();
  });

  it("sends the user to sign in again when the session ended", async () => {
    reviewMapping.mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: "/auth/login?returnTo=%2Flibrary%2FRES-01",
    });
    row(mapping, true);
    await userEvent.click(screen.getByRole("button", { name: t.markReviewed }));
    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith("/auth/login?returnTo=%2Flibrary%2FRES-01");
    });
  });
});
