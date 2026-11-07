// @vitest-environment jsdom
import { reportRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_WORKSPACE } from "./fixtures";

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/index");
  return {
    getTranslations: (ns: string) =>
      Promise.resolve(createTranslator({ locale: "en", messages, namespace: ns as never })),
  };
});
vi.mock("../../lib/current-viewer", () => ({ requireViewer: vi.fn() }));
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../../lib/page-result", () => ({ failureScreen: vi.fn(() => "failure") }));

const { requireViewer } = await import("../../lib/current-viewer");
const { callApi } = await import("../../lib/server-api");
const { default: HomePage } = await import("../../app/(app)/page");

const TILES = [{ key: "openRisks", value: 17, change: null }];
const PERIOD = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
const viewer = (viewMode: string, permissions: string[]) =>
  vi.mocked(requireViewer).mockResolvedValue({
    ok: true,
    me: { displayName: "Rita Reader", viewMode, permissions },
  } as never);

const routesCalled = () => vi.mocked(callApi).mock.calls.map((c) => c[0]);
const props = async () => {
  const el = (await HomePage({ searchParams: Promise.resolve({}) })) as {
    props: { glance?: unknown };
  };
  return el.props;
};

beforeEach(() => {
  vi.mocked(requireViewer).mockReset();
  vi.mocked(callApi).mockReset();
  vi.mocked(callApi).mockImplementation(((route: unknown) =>
    Promise.resolve(
      route === reportRoutes.board
        ? { ok: true, data: { tiles: TILES, period: PERIOD } }
        : {
            ok: true,
            data: { setup: { completedAt: null }, ...EMPTY_WORKSPACE },
          },
    )) as never);
});

describe("Home page At a glance", () => {
  it("loads the default period's board tiles only in executive mode with reports.read", async () => {
    viewer("executive", ["reports.read"]);
    expect((await props()).glance).toEqual({ tiles: TILES, period: PERIOD });
    const call = vi.mocked(callApi).mock.calls.find((c) => c[0] === reportRoutes.board);
    expect(call?.[1]).toEqual({ query: {} });
  });

  it("does not load it in the professional view", async () => {
    viewer("professional", ["reports.read"]);
    expect((await props()).glance).toBeUndefined();
    expect(routesCalled()).not.toContain(reportRoutes.board);
  });

  it("does not load it without reports.read", async () => {
    viewer("executive", []);
    expect((await props()).glance).toBeUndefined();
    expect(routesCalled()).not.toContain(reportRoutes.board);
  });

  it("leaves the block out, not the page, when the board call fails", async () => {
    viewer("executive", ["reports.read"]);
    vi.mocked(callApi).mockImplementation(((route: unknown) =>
      Promise.resolve(
        route === reportRoutes.board
          ? { ok: false, kind: "unavailable", details: [] }
          : { ok: true, data: { setup: { completedAt: null }, ...EMPTY_WORKSPACE } },
      )) as never);
    expect((await props()).glance).toBeUndefined();
  });
});
