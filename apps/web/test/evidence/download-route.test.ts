import { evidenceRoutes } from "@isms/contracts";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/index";

vi.mock("../../lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/server-api")>()),
  accessTokenFor: vi.fn(),
}));
vi.mock("../../lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-client")>()),
  apiDownload: vi.fn(),
}));

const { accessTokenFor } = await import("../../lib/server-api");
const { ApiError, apiDownload } = await import("../../lib/api-client");
const { GET } = await import("../../app/(app)/evidence/[id]/download/route");

const ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const SHA = "b".repeat(64);
const ctx = { params: Promise.resolve({ id: ID }) };
const req = () => new NextRequest(new URL(`/evidence/${ID}/download`, "http://localhost:3000"));
const enc = new TextEncoder();

const upstreamHeaders = (length: number) => ({
  "content-type": "application/pdf",
  "content-length": String(length),
  "content-disposition": `attachment; filename="policy.pdf"; filename*=UTF-8''policy.pdf`,
  "x-content-type-options": "nosniff",
  "x-evidence-sha256": SHA,
  "cache-control": "private, no-store",
  "set-cookie": "upstream=1",
});

/** Sends `chunks`, then ends or fails the stream. */
function upstream(chunks: string[], end: "close" | "error"): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      const next = chunks[i++];
      if (next !== undefined) controller.enqueue(enc.encode(next));
      else if (end === "close") controller.close();
      else controller.error(new Error("socket closed"));
    },
  });
}

beforeEach(() => {
  vi.mocked(accessTokenFor).mockReset().mockResolvedValue({ ok: true, token: "token-1" });
  vi.mocked(apiDownload).mockReset();
});

describe("GET /evidence/[id]/download", () => {
  it("streams the file with the API's download headers", async () => {
    vi.mocked(apiDownload).mockResolvedValue(
      new Response(upstream(["%PDF-", "1.7"], "close"), { headers: upstreamHeaders(8) }),
    );
    const res = await GET(req(), ctx);
    expect(apiDownload).toHaveBeenCalledWith(evidenceRoutes.download, { id: ID }, "token-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(upstreamHeaders(8)["content-disposition"]);
    expect(res.headers.get("x-evidence-sha256")).toBe(SHA);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("%PDF-1.7");
  });

  it("fails the download when the API stops short of Content-Length", async () => {
    vi.mocked(apiDownload).mockResolvedValue(
      new Response(upstream(["%PDF-"], "close"), { headers: upstreamHeaders(8) }),
    );
    const res = await GET(req(), ctx);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("fails the download when the API cuts the connection", async () => {
    vi.mocked(apiDownload).mockResolvedValue(
      new Response(upstream(["%PDF-"], "error"), { headers: upstreamHeaders(8) }),
    );
    const res = await GET(req(), ctx);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("refuses to pass on a file whose length the API did not declare", async () => {
    const headers: Record<string, string> = upstreamHeaders(8);
    delete headers["content-length"];
    vi.mocked(apiDownload).mockResolvedValue(
      new Response(upstream(["%PDF-1.7"], "close"), { headers }),
    );
    const res = await GET(req(), ctx);
    expect(res.status).toBe(503);
  });

  it("sends a signed-out viewer to sign in and back", async () => {
    vi.mocked(accessTokenFor).mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: `/auth/login?returnTo=%2Fevidence%2F${ID}%2Fdownload`,
    });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(303);
    expect(accessTokenFor).toHaveBeenCalledWith(`/evidence/${ID}/download`);
  });

  it.each([
    [404, "NOT_FOUND", 404, en.evidence.download.notFound],
    [403, "FORBIDDEN", 404, en.evidence.download.notFound],
    [409, "CONFLICT", 503, en.evidence.download.unavailable],
    [0, "INTERNAL", 503, en.evidence.download.unavailable],
  ] as const)("answers an API %i with %i and plain words", async (status, code, out, text) => {
    vi.mocked(apiDownload).mockRejectedValue(new ApiError({ status, code, message: "x" }));
    const res = await GET(req(), ctx);
    expect(res.status).toBe(out);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(text);
  });

  it("answers an id that is not a UUID with 404", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "../x" }) });
    expect(res.status).toBe(404);
    expect(apiDownload).not.toHaveBeenCalled();
  });
});
