import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/current-viewer", () => ({
  requireViewer: () =>
    Promise.resolve({ ok: true, me: { permissions: ["library.read"], viewMode: "professional" } }),
}));
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../../lib/page-result", () => ({
  failureScreen: vi.fn((r: { kind: string }) => `failure:${r.kind}`),
}));
vi.mock("next-intl/server", () => ({ getTranslations: () => Promise.resolve((k: string) => k) }));
vi.mock("../../components/status/status-screen", () => ({ StatusScreen: () => null }));
vi.mock("../../components/motion/entrance", () => ({ Entrance: () => null }));
vi.mock("../../components/library/control-filters", () => ({ ControlFilters: () => null }));
vi.mock("../../components/library/control-list", () => ({ ControlList: () => null }));

const { callApi } = await import("../../lib/server-api");
const { ControlList } = await import("../../components/library/control-list");
const { default: LibraryPage } = await import("../../app/(app)/library/page");

type Query = Record<string, unknown>;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `X-${String(i)}` }));

/** Answers the list with `narrowed` items for a narrowed query and 99 for the whole library. */
function answer(narrowed: number, total: unknown = { ok: true, data: { items: items(99) } }) {
  vi.mocked(callApi).mockImplementation(((route: { path: string }, input: { query?: Query }) => {
    if (route.path.endsWith("/frameworks")) {
      return Promise.resolve({ ok: true, data: { frameworks: [] } });
    }
    const whole = Object.keys(input.query ?? {}).every(
      (k) => k === "review" && input.query?.review === "all",
    );
    return Promise.resolve(whole ? total : { ok: true, data: { items: items(narrowed) } });
  }) as never);
}

function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  return find(node.props.children, type);
}

const page = (params: Record<string, string>) =>
  LibraryPage({ searchParams: Promise.resolve(params) }) as Promise<ReactNode>;

beforeEach(() => {
  vi.mocked(callApi).mockReset();
});

describe("library page", () => {
  it("counts the matches out of the whole library when filters or a search narrow it", async () => {
    answer(59);
    const list = find(await page({ framework: "nist-csf-2.0", q: "x" }), ControlList);
    expect((list?.props.items as unknown[]).length).toBe(59);
    expect(list?.props.total).toBe(99);
  });

  it("asks for the whole library only when something narrows the list", async () => {
    answer(99);
    const list = find(await page({}), ControlList);
    expect(list?.props.total).toBeUndefined();
    expect(vi.mocked(callApi)).toHaveBeenCalledTimes(2);
  });

  it("still shows the list when the whole-library count fails", async () => {
    answer(3, { ok: false, kind: "unavailable", details: [] });
    const list = find(await page({ category: "access" }), ControlList);
    expect((list?.props.items as unknown[]).length).toBe(3);
    expect(list?.props.total).toBeUndefined();
  });
});
