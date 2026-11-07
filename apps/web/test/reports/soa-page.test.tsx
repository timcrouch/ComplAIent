// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withMessages } from "../intl";

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
vi.mock("../../lib/actions/reports", () => ({ setApplicability: vi.fn() }));
vi.mock("../../components/status/status-screen", () => ({
  StatusScreen: ({ kind }: { kind: string }) => <p>status:{kind}</p>,
}));

const { requireViewer } = await import("../../lib/current-viewer");
const { callApi } = await import("../../lib/server-api");
const { default: SoaPage } = await import("../../app/(app)/reports/soa/page");

const FW = { key: "iso", name: "ISO/IEC 27001", versionLabel: "2022" };
const data = (over: object) => ({
  ok: true,
  data: { frameworks: [FW], framework: FW, groups: [], rows: [], canManage: false, ...over },
});
const render = async (params: Record<string, string> = {}) =>
  withMessages(await SoaPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.mocked(requireViewer).mockReset();
  vi.mocked(callApi).mockReset();
  vi.mocked(requireViewer).mockResolvedValue({
    ok: true,
    me: { permissions: ["reports.read"] },
  } as never);
});

describe("SoA page", () => {
  it("is forbidden without reports.read", async () => {
    vi.mocked(requireViewer).mockResolvedValue({ ok: true, me: { permissions: [] } } as never);
    await render();
    expect(screen.getByText("status:forbidden")).toBeTruthy();
    expect(callApi).not.toHaveBeenCalled();
  });

  it("explains in plain words when no framework is confirmed", async () => {
    vi.mocked(callApi).mockResolvedValue(data({ frameworks: [], framework: null }) as never);
    await render();
    expect(screen.getByText(/No framework is confirmed yet/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("still shows the picker when frameworks exist but none is selected", async () => {
    vi.mocked(callApi).mockResolvedValue(data({ framework: null }) as never);
    await render();
    expect(screen.getByRole("navigation", { name: "Framework" })).toBeTruthy();
    expect(screen.getByText(/No framework is confirmed yet/)).toBeTruthy();
  });

  it("shows the default framework with a notice when the framework is not confirmed", async () => {
    vi.mocked(callApi).mockImplementation(((_route: unknown, input: { query?: object }) =>
      Promise.resolve(
        input.query && "framework" in input.query
          ? { ok: false, kind: "not-found", details: [] }
          : data({}),
      )) as never);
    await render({ framework: "old" });
    expect(vi.mocked(callApi).mock.calls.map((c) => c[1])).toEqual([
      { query: { framework: "old" } },
      { query: {} },
    ]);
    const notice = screen.getByText("That framework is not confirmed; showing ISO/IEC 27001 2022.");
    expect(notice.getAttribute("role")).toBe("status");
  });

  it("asks the API for the framework in the URL and reads the filter from it", async () => {
    vi.mocked(callApi).mockResolvedValue(data({}) as never);
    await render({ framework: "iso", undecided: "1" });
    expect(vi.mocked(callApi).mock.calls[0]?.[1]).toEqual({ query: { framework: "iso" } });
    expect(screen.getByRole("link", { name: "Only undecided" }).getAttribute("href")).toBe(
      "/reports/soa?framework=iso",
    );
  });
});
