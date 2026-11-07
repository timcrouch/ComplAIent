import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/current-viewer", () => ({
  requireViewer: () => Promise.resolve({ ok: true, me: { permissions: ["library.read"] } }),
}));
vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("../../lib/page-result", () => ({
  failureScreen: vi.fn((r: { kind: string }) => `failure:${r.kind}`),
}));
vi.mock("../../components/status/status-screen", () => ({ StatusScreen: () => null }));
vi.mock("../../components/library/control-detail", () => ({ ControlDetail: () => null }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: () => undefined }));

const { callApi } = await import("../../lib/server-api");
const { default: ControlPage } = await import("../../app/(app)/library/[code]/page");

const control = { ok: true, data: { code: "RES-01", title: "T" } };
const op = { ok: true, data: { code: "RES-01" } };
const fail = (kind: string) => ({ ok: false, kind, details: [] });
function answer(first: unknown, second: unknown) {
  vi.mocked(callApi).mockImplementation(((route: { path: string }) =>
    Promise.resolve(route.path.endsWith("/operation") ? second : first)) as never);
}
const page = () => ControlPage({ params: Promise.resolve({ code: "RES-01" }) });

beforeEach(() => {
  vi.mocked(callApi).mockReset();
});

describe("control page", () => {
  it("passes the operation to the detail", async () => {
    answer(control, op);
    const el = (await page()) as ReactElement<{ operation: unknown }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.props.operation).toEqual(op.data);
  });

  it.each(["unavailable", "forbidden"])("keeps the page when the operation is %s", async (kind) => {
    answer(control, fail(kind));
    const el = (await page()) as ReactElement<{ operation: unknown }>;
    expect(el.props.operation).toBeNull();
  });

  it.each(["signed-out", "reauth"])("sends %s to the failure screen", async (kind) => {
    answer(control, fail(kind));
    expect(await page()).toBe(`failure:${kind}`);
  });

  it("a missing control is a full failure", async () => {
    answer(fail("not-found"), op);
    expect(await page()).toBe("failure:not-found");
  });
});
