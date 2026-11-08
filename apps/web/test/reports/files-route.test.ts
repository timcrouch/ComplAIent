import { reportRoutes } from "@isms/contracts";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/index";

vi.mock("../../lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/server-api")>()),
  accessTokenFor: vi.fn(),
  failureOf: vi.fn(),
}));
vi.mock("../../lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-client")>()),
  apiDownload: vi.fn(),
}));

const { accessTokenFor, failureOf } = await import("../../lib/server-api");
const actual = await vi.importActual<typeof import("../../lib/server-api")>("../../lib/server-api");
const { ApiError, apiDownload } = await import("../../lib/api-client");
const { GET } = await import("../../app/(app)/reports/files/[file]/route");

const t = en.reports.files;
const PDF = "application/pdf";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid: unknown = expect.stringMatching(UUID);
const anyOptions: unknown = expect.objectContaining({ requestId: uuid });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const call = (file: string, search = "", init?: { headers?: Record<string, string> }) =>
  GET(new NextRequest(new URL(`/reports/files/${file}${search}`, "http://localhost:3000"), init), {
    params: Promise.resolve({ file }),
  });

const upstream = (type: string, body = "%PDF-1.7") =>
  new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(body.length),
      "content-disposition": `attachment; filename="complaient-board-2026-11-06.pdf"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "set-cookie": "upstream=1",
    },
  });

beforeEach(() => {
  vi.mocked(accessTokenFor).mockReset().mockResolvedValue({ ok: true, token: "token-1" });
  vi.mocked(apiDownload).mockReset();
  vi.mocked(failureOf).mockReset().mockImplementation(actual.failureOf);
});

describe("GET /reports/files/[file]", () => {
  it.each([
    ["risk-register.xlsx", reportRoutes.registerXlsx, XLSX],
    ["risk-register.pdf", reportRoutes.registerPdf, PDF],
    ["soa.xlsx", reportRoutes.soaXlsx, XLSX],
    ["soa.pdf", reportRoutes.soaPdf, PDF],
    ["board.pdf", reportRoutes.boardPdf, PDF],
  ] as const)("streams %s from its API route", async (file, route, type) => {
    vi.mocked(apiDownload).mockResolvedValue(upstream(type));
    const res = await call(file);
    expect(apiDownload).toHaveBeenCalledWith(route, {}, "token-1", {}, anyOptions);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="complaient-board-2026-11-06.pdf"`,
    );
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("forwards the query string", async () => {
    vi.mocked(apiDownload).mockResolvedValue(upstream(PDF));
    await call("risk-register.pdf", "?filter=aboveAppetite&includeClosed=true");
    expect(apiDownload).toHaveBeenCalledWith(
      reportRoutes.registerPdf,
      {},
      "token-1",
      { filter: "aboveAppetite", includeClosed: "true" },
      anyOptions,
    );
    expect(accessTokenFor).toHaveBeenCalledWith(
      "/reports/files/risk-register.pdf?filter=aboveAppetite&includeClosed=true",
      anyOptions,
    );
  });

  it("forwards only the file's own query keys", async () => {
    vi.mocked(apiDownload).mockResolvedValue(upstream(PDF));
    await call("board.pdf", "?period=2026-10&filter=aboveAppetite&extra=1");
    expect(apiDownload).toHaveBeenCalledWith(
      reportRoutes.boardPdf,
      {},
      "token-1",
      { period: "2026-10" },
      anyOptions,
    );
    expect(accessTokenFor).toHaveBeenCalledWith(
      "/reports/files/board.pdf?period=2026-10",
      anyOptions,
    );
    await call("risk-register.xlsx", "?filter=aboveAppetite&unknown=x");
    expect(apiDownload).toHaveBeenLastCalledWith(
      reportRoutes.registerXlsx,
      {},
      "token-1",
      { filter: "aboveAppetite" },
      anyOptions,
    );
  });

  // The proxy skips paths with a file extension, so an inbound x-request-id is the client's.
  it("uses one fresh server-minted request id end to end, never the client's", async () => {
    const client = "3b241101-e2bb-4255-8caf-4136c566a962";
    vi.mocked(apiDownload).mockRejectedValue(
      new ApiError({ status: 403, code: "FORBIDDEN", message: "x" }),
    );
    await call("soa.pdf", "", { headers: { "x-request-id": client } });
    const tokenOptions = vi.mocked(accessTokenFor).mock.calls[0]?.[1];
    expect(tokenOptions?.requestId).toMatch(UUID);
    expect(tokenOptions?.requestId).not.toBe(client);
    expect(vi.mocked(apiDownload).mock.calls[0]?.[4]).toEqual(tokenOptions);
    expect(vi.mocked(failureOf).mock.calls[0]?.[3]).toEqual(tokenOptions);
    await call("soa.pdf");
    expect(vi.mocked(accessTokenFor).mock.calls[1]?.[1]?.requestId).not.toBe(
      tokenOptions?.requestId,
    );
  });

  it.each(["register.xlsx", "board.xlsx", "..", "soa.pdf.exe", "risk-register.csv"])(
    "answers %s, not on the allowlist, with 404 and no API call",
    async (file) => {
      const res = await call(file);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(t.notFound);
      expect(apiDownload).not.toHaveBeenCalled();
    },
  );

  it("answers a query the contract rejects with 400", async () => {
    const res = await call("risk-register.xlsx", "?filter=nonsense");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(t.invalid);
    expect(apiDownload).not.toHaveBeenCalled();
  });

  it("sends a signed-out viewer to sign in and back", async () => {
    vi.mocked(accessTokenFor).mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: "/auth/login?returnTo=%2Freports%2Ffiles%2Fboard.pdf",
    });
    const res = await call("board.pdf");
    expect(res.status).toBe(303);
    expect(apiDownload).not.toHaveBeenCalled();
  });

  it.each([
    [403, "FORBIDDEN", 403, t.forbidden],
    [404, "NOT_FOUND", 404, t.notFound],
    [400, "VALIDATION_FAILED", 400, t.invalid],
    [409, "CONFLICT", 409, t.tooLarge],
    [0, "INTERNAL", 503, t.unavailable],
  ] as const)("answers an API %i with %i and plain words", async (status, code, out, text) => {
    vi.mocked(apiDownload).mockRejectedValue(new ApiError({ status, code, message: "x" }));
    const res = await call("risk-register.pdf");
    expect(res.status).toBe(out);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(text);
  });

  it("refuses an answer without a body", async () => {
    vi.mocked(apiDownload).mockResolvedValue(new Response(null, { status: 200 }));
    expect((await call("board.pdf")).status).toBe(503);
  });
});
