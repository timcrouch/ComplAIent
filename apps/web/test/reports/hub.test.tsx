// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterDownloads } from "../../components/reports/register-downloads";
import { ReportsHub } from "../../components/reports/reports-hub";
import { navItemsFor } from "../../components/shell/nav-items";
import en from "../../messages/index";
import { withMessages } from "../intl";

vi.mock("next-intl/server", () => ({ getTranslations: () => Promise.resolve((k: string) => k) }));
vi.mock("../../lib/current-viewer", () => ({ requireViewer: vi.fn() }));
vi.mock("../../components/status/status-screen", () => ({
  StatusScreen: ({ kind }: { kind: string }) => `status:${kind}`,
}));

const { requireViewer } = await import("../../lib/current-viewer");
const { default: ReportsPage } = await import("../../app/(app)/reports/page");

beforeEach(() => {
  vi.mocked(requireViewer).mockReset();
});

describe("reports page", () => {
  it("is forbidden without reports.read", async () => {
    vi.mocked(requireViewer).mockResolvedValue({
      ok: true,
      me: { permissions: ["risks.read"] },
    } as never);
    expect(JSON.stringify(await ReportsPage())).toContain("forbidden");
  });

  it("shows the hub with reports.read", async () => {
    vi.mocked(requireViewer).mockResolvedValue({
      ok: true,
      me: { permissions: ["reports.read"] },
    } as never);
    expect(JSON.stringify(await ReportsPage())).not.toContain("forbidden");
  });
});

describe("ReportsHub", () => {
  it("has a card per report with its links", () => {
    withMessages(<ReportsHub />);
    const register = screen.getByRole("group", { name: "Risk register" });
    expect(within(register).getByRole("link", { name: /Excel/ }).getAttribute("href")).toBe(
      "/reports/files/risk-register.xlsx",
    );
    expect(within(register).getByRole("link", { name: /PDF/ }).getAttribute("href")).toBe(
      "/reports/files/risk-register.pdf",
    );
    expect(register.textContent).toContain("Large registers: use Excel");
    const soa = screen.getByRole("group", { name: "Statement of Applicability" });
    expect(within(soa).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe(
      "/reports/soa",
    );
    expect(within(soa).getByRole("link", { name: /Excel/ }).getAttribute("href")).toBe(
      "/reports/files/soa.xlsx",
    );
    expect(within(soa).getByRole("link", { name: /PDF/ }).getAttribute("href")).toBe(
      "/reports/files/soa.pdf",
    );
    const board = screen.getByRole("group", { name: "Board pack" });
    expect(within(board).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe(
      "/reports/board",
    );
    expect(within(board).getByRole("link", { name: /PDF/ }).getAttribute("href")).toBe(
      "/reports/files/board.pdf",
    );
    expect(within(board).queryByRole("link", { name: /Excel/ })).toBeNull();
  });
});

describe("register download links", () => {
  it("pass the current filter on", () => {
    withMessages(<RegisterDownloads filter="aboveAppetite" includeClosed={false} />);
    expect(screen.getByRole("link", { name: "Download as Excel" }).getAttribute("href")).toBe(
      "/reports/files/risk-register.xlsx?filter=aboveAppetite",
    );
    expect(screen.getByRole("link", { name: "Download as PDF" }).getAttribute("href")).toBe(
      "/reports/files/risk-register.pdf?filter=aboveAppetite",
    );
  });

  it("pass includeClosed only when set", () => {
    withMessages(<RegisterDownloads filter="all" includeClosed />);
    expect(screen.getByRole("link", { name: "Download as Excel" }).getAttribute("href")).toBe(
      "/reports/files/risk-register.xlsx?filter=all&includeClosed=true",
    );
  });

  it("carry no download attribute, so the proxy's plain-text errors stay readable", () => {
    withMessages(<RegisterDownloads filter="all" includeClosed={false} />);
    for (const link of screen.getAllByRole("link"))
      expect(link.hasAttribute("download")).toBe(false);
  });

  it("say the map-cell filter is not applied only when one is active", () => {
    const hint = en.reports.registerLinks.cellHint;
    const { unmount } = withMessages(<RegisterDownloads filter="all" includeClosed={false} />);
    expect(screen.queryByText(hint)).toBeNull();
    unmount();
    withMessages(<RegisterDownloads filter="all" includeClosed={false} cellFilter />);
    expect(screen.getByText(hint)).toBeTruthy();
  });
});

describe("Reports navigation", () => {
  it("is for reports.read holders only", () => {
    expect(navItemsFor(["risks.read"]).map((i) => i.key)).not.toContain("reports");
    expect(navItemsFor(["reports.read"]).map((i) => [i.key, i.href])).toContainEqual([
      "reports",
      "/reports",
    ]);
  });
});
