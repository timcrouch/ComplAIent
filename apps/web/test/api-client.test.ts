import { defineRoute, identityRoutes, reportRoutes } from "@isms/contracts";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiCall, apiDownload, MAX_RESPONSE_BYTES } from "../lib/api-client";

const me = {
  id: "u1",
  email: "rita@example.test",
  displayName: "Rita Reporter",
  roles: [],
  permissions: ["me.read"],
  viewMode: "guided",
  theme: "system",
  modules: [],
};

const itemRoute = defineRoute({
  method: "post",
  path: "/api/v1/things/{id}/notes/{noteId}",
  summary: "test route",
  request: {
    params: z.object({ id: z.string().min(1), noteId: z.string() }),
    query: z.object({ dryRun: z.boolean().optional(), tag: z.array(z.string()).optional() }),
    body: z.object({ text: z.string().min(1) }),
  },
  responses: { 201: z.object({ ok: z.literal(true) }), 204: z.undefined() },
});

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url: url instanceof Request ? url.url : (url?.toString() ?? ""), init: init ?? {} };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("apiCall", () => {
  it("apiCall parses success with contract schema", async () => {
    fetchMock.mockResolvedValue(json(200, { ...me, extra: "ignored" }));
    const result = await apiCall(identityRoutes.me, {}, "token-abc");
    expect(result).toEqual(me);
    const { url, init } = lastCall();
    expect(url).toBe("http://api.test/api/v1/me");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token-abc");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
  });

  it("apiCall throws ApiError with code from ErrorResponse", async () => {
    fetchMock.mockResolvedValue(
      json(403, { error: { code: "FORBIDDEN", message: "Not allowed", requestId: "req-1" } }),
    );
    const err = await apiCall(identityRoutes.me, {}, "t").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Not allowed",
      requestId: "req-1",
    });
  });

  it("maps an unparseable error body to INTERNAL", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL",
    });
  });

  it("maps an error body that is JSON but not an ErrorResponse to INTERNAL", async () => {
    fetchMock.mockResolvedValue(json(500, { message: "boom" }));
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL",
    });
  });

  it("apiCall rejects a response that violates the schema", async () => {
    fetchMock.mockResolvedValue(json(200, { ...me, viewMode: "nonsense" }));
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({
      status: 200,
      code: "INTERNAL",
    });
  });

  it("rejects a 2xx status the contract does not declare", async () => {
    fetchMock.mockResolvedValue(json(202, me));
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("substitutes URL-encoded params and serialises query and body", async () => {
    fetchMock.mockResolvedValue(json(201, { ok: true }));
    const result = await apiCall(
      itemRoute,
      {
        params: { id: "a/b?c", noteId: "n 1" },
        query: { dryRun: true, tag: ["x", "y"] },
        body: { text: "hello" },
      },
      "t",
    );
    expect(result).toEqual({ ok: true });
    const { url, init } = lastCall();
    expect(url).toBe("http://api.test/api/v1/things/a%2Fb%3Fc/notes/n%201?dryRun=true&tag=x&tag=y");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ text: "hello" }));
  });

  it("returns undefined for a declared 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiCall(
      itemRoute,
      { params: { id: "a", noteId: "b" }, query: {}, body: { text: "x" } },
      "t",
    );
    expect(result).toBeUndefined();
  });

  it("validates input before sending", async () => {
    await expect(
      apiCall(itemRoute, { params: { id: "", noteId: "b" }, query: {}, body: { text: "x" } }, "t"),
    ).rejects.toMatchObject({ status: 0, code: "VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([".", "..", "...", ""])("rejects the dot-segment / empty path param %j", async (id) => {
    await expect(
      apiCall(itemRoute, { params: { id: "x", noteId: id }, query: {}, body: { text: "x" } }, "t"),
    ).rejects.toMatchObject({ status: 0, code: "VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes dots that are not a whole segment", async () => {
    fetchMock.mockResolvedValue(json(201, { ok: true }));
    await apiCall(
      itemRoute,
      { params: { id: "../x", noteId: "a.b" }, query: {}, body: { text: "x" } },
      "t",
    );
    expect(lastCall().url).toBe("http://api.test/api/v1/things/..%2Fx/notes/a.b");
  });

  it("backstop: refuses a URL whose parsed path differs from the route template", async () => {
    const traversing = defineRoute({
      method: "get",
      path: "/api/v1/things/../admin",
      summary: "bad template",
      responses: { 200: z.object({}) },
    });
    await expect(apiCall(traversing, {}, "t")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out when the body stalls after the headers arrived", async () => {
    vi.useFakeTimers();
    try {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":'));
        },
      });
      fetchMock.mockResolvedValue(new Response(stalled, { status: 200 }));
      const pending = apiCall(identityRoutes.me, {}, "t").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({ status: 0, code: "INTERNAL" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a response larger than 5 MB", async () => {
    expect(MAX_RESPONSE_BYTES).toBe(5_000_000);
    // Streamed in 1 MB chunks with no Content-Length: the cap applies while reading.
    const chunk = new Uint8Array(1_000_000).fill(32);
    let sent = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 100) controller.enqueue(chunk);
        else controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(big, { status: 200 }));
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({
      status: 0,
      code: "INTERNAL",
      message: "API response too large",
    });
    // Reading stopped soon after the cap, not at the end of the 100 MB stream.
    expect(sent).toBeLessThan(10);
  });

  it("rejects a declared Content-Length over the cap without reading the body", async () => {
    const res = json(200, me);
    res.headers.set("content-length", String(MAX_RESPONSE_BYTES + 1));
    fetchMock.mockResolvedValue(res);
    await expect(apiCall(identityRoutes.me, {}, "t")).rejects.toMatchObject({
      status: 0,
      message: "API response too large",
    });
  });

  it("accepts a body of exactly the cap", async () => {
    const body = JSON.stringify(me);
    const padded = body + " ".repeat(MAX_RESPONSE_BYTES - new TextEncoder().encode(body).length);
    fetchMock.mockResolvedValue(new Response(padded, { status: 200 }));
    expect(await apiCall(identityRoutes.me, {}, "t")).toEqual(me);
  });

  it("aborts after 10 seconds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason as Error);
            });
          }),
      );
      const pending = apiCall(identityRoutes.me, {}, "t").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({ status: 0, code: "INTERNAL" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("apiCall with a base path in API_BASE_URL", () => {
  it.each(["http://gateway.test/isms", "http://gateway.test/isms/"])(
    "keeps the prefix of %s",
    async (base) => {
      vi.resetModules();
      vi.stubEnv("API_BASE_URL", base);
      try {
        const fresh = await import("../lib/api-client");
        fetchMock.mockResolvedValue(json(200, me));
        await fresh.apiCall(identityRoutes.me, {}, "t");
        expect(lastCall().url).toBe("http://gateway.test/isms/api/v1/me");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});

describe("apiDownload with a query", () => {
  it("checks the query against the contract and sends it as given", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF-", { status: 200 }));
    const res = await apiDownload(reportRoutes.registerPdf, {}, "t", {
      filter: "aboveAppetite",
      includeClosed: "true",
    });
    expect(res.status).toBe(200);
    expect(lastCall().url).toBe(
      "http://api.test/api/v1/reports/register.pdf?filter=aboveAppetite&includeClosed=true",
    );
  });

  it("sends the given request id instead of the current request's", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF-", { status: 200 }));
    const id = "3b241101-e2bb-4255-8caf-4136c566a962";
    await apiDownload(reportRoutes.soaPdf, {}, "t", {}, { requestId: id });
    expect(new Headers(lastCall().init.headers).get("x-request-id")).toBe(id);
  });

  it("refuses a query the contract rejects without calling the API", async () => {
    fetchMock.mockClear();
    await expect(
      apiDownload(reportRoutes.registerPdf, {}, "t", { filter: "nonsense" as "all" }),
    ).rejects.toMatchObject({ status: 0, code: "VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
