// @vitest-environment jsdom
import { reportRoutes } from "@isms/contracts";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withMessages } from "../intl";
import { PACK, SCALE } from "./board-fixtures";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/index");
  return {
    getTranslations: (ns: string) =>
      Promise.resolve(createTranslator({ locale: "en", messages, namespace: ns as never })),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("../../lib/current-viewer", () => ({ requireViewer: vi.fn() }));
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../../lib/page-result", () => ({ failureScreen: vi.fn(() => "failure") }));
vi.mock("../../lib/actions/reports", () => ({
  draftNarrative: vi.fn(),
  approveNarrative: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));
vi.mock("../../components/status/status-screen", () => ({
  StatusScreen: ({ kind }: { kind: string }) => <p>status:{kind}</p>,
}));

const { requireViewer } = await import("../../lib/current-viewer");
const { callApi } = await import("../../lib/server-api");
const { default: BoardPage } = await import("../../app/(app)/reports/board/page");

const render = async (params: Record<string, string | string[]> = {}) =>
  withMessages(await BoardPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.mocked(requireViewer).mockReset();
  vi.mocked(callApi).mockReset();
  vi.mocked(requireViewer).mockResolvedValue({
    ok: true,
    me: { permissions: ["reports.read"] },
  } as never);
  vi.mocked(callApi).mockImplementation(((route: unknown) =>
    Promise.resolve(
      route === reportRoutes.board
        ? { ok: true, data: PACK }
        : { ok: true, data: { riskScale: SCALE, defaultRiskScale: SCALE } },
    )) as never);
});

describe("Board page", () => {
  it("is forbidden without reports.read", async () => {
    vi.mocked(requireViewer).mockResolvedValue({ ok: true, me: { permissions: [] } } as never);
    await render();
    expect(screen.getByText("status:forbidden")).toBeTruthy();
    expect(callApi).not.toHaveBeenCalled();
  });

  it("asks the API for the period in the URL and shows the pack", async () => {
    await render({ period: "2026-Q2" });
    const call = vi.mocked(callApi).mock.calls.find((c) => c[0] === reportRoutes.board);
    expect(call?.[1]).toEqual({ query: { period: "2026-Q2" } });
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("Open risks")).toBeTruthy();
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });

  it("shows the default period with a notice when the period is unknown or expired", async () => {
    const month = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
    vi.mocked(callApi).mockImplementation(((route: unknown, input: { query?: object }) =>
      Promise.resolve(
        route !== reportRoutes.board
          ? { ok: true, data: { riskScale: SCALE, defaultRiskScale: SCALE } }
          : input.query && "period" in input.query
            ? { ok: false, kind: "invalid", details: [{ path: "period", message: "Unknown" }] }
            : { ok: true, data: { ...PACK, period: month } },
      )) as never);
    await render({ period: "2025-01" });
    const calls = vi.mocked(callApi).mock.calls.filter((c) => c[0] === reportRoutes.board);
    expect(calls.map((c) => c[1])).toEqual([{ query: { period: "2025-01" } }, { query: {} }]);
    const notice = screen.getByText("That period is no longer available; showing October 2026.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.getByText("Open risks")).toBeTruthy();
  });

  it("uses the default period when none is given", async () => {
    await render();
    const call = vi.mocked(callApi).mock.calls.find((c) => c[0] === reportRoutes.board);
    expect(call?.[1]).toEqual({ query: {} });
  });
});
