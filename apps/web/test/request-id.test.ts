import { identityRoutes } from "@isms/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = { headers: new Headers() as Headers | null };
vi.mock("next/headers", () => ({
  headers: () =>
    state.headers ? Promise.resolve(state.headers) : Promise.reject(new Error("no request")),
}));

const { REQUEST_ID_HEADER, requestId, withRequestId } = await import("../lib/request-id");
const { requestLog } = await import("../lib/log");
const { apiCall } = await import("../lib/api-client");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROXY_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  state.headers = new Headers();
  fetchMock.mockReset();
});

describe("requestId", () => {
  it("uses the id the proxy set for this request", async () => {
    state.headers = new Headers({ [REQUEST_ID_HEADER]: PROXY_ID });
    expect(await requestId()).toBe(PROXY_ID);
  });

  it("generates a UUID when the header is missing, malformed, or there is no request", async () => {
    expect(await requestId()).toMatch(UUID);
    state.headers = new Headers({ [REQUEST_ID_HEADER]: "bad id <script>" });
    expect(await requestId()).toMatch(UUID);
    state.headers = null;
    expect(await requestId()).toMatch(UUID);
  });
});

describe("withRequestId", () => {
  const OWN = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

  it("overrides the inbound header (a client's own value on a path the proxy skips)", async () => {
    state.headers = new Headers({ [REQUEST_ID_HEADER]: PROXY_ID });
    expect(await withRequestId(OWN, () => requestId())).toBe(OWN);
    expect(await requestId()).toBe(PROXY_ID);
  });

  it("reaches apiCall and request log events inside the callback", async () => {
    state.headers = new Headers({ [REQUEST_ID_HEADER]: PROXY_ID });
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await withRequestId(OWN, async () => {
      await expect(apiCall(identityRoutes.me, {}, "tok")).rejects.toThrow();
      expect((await requestLog()).bindings()).toMatchObject({ requestId: OWN });
    });
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(new Headers(init?.headers).get("x-request-id")).toBe(OWN);
  });
});

describe("request id propagation", () => {
  it("apiCall forwards the request id to the API", async () => {
    state.headers = new Headers({ [REQUEST_ID_HEADER]: PROXY_ID });
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(apiCall(identityRoutes.me, {}, "tok")).rejects.toThrow();
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(new Headers(init?.headers).get("x-request-id")).toBe(PROXY_ID);
  });

  it("request log events carry the request id", async () => {
    state.headers = new Headers({ [REQUEST_ID_HEADER]: PROXY_ID });
    expect((await requestLog()).bindings()).toMatchObject({ requestId: PROXY_ID });
  });
});
