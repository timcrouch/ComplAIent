import { evidenceRoutes, type EvidenceDto } from "@isms/contracts";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testEnv } from "../../vitest.config";

vi.mock("../../lib/server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/server-api")>()),
  accessTokenFor: vi.fn(),
}));
vi.mock("../../lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-client")>()),
  apiUpload: vi.fn(),
}));

const { accessTokenFor } = await import("../../lib/server-api");
const { ApiError, apiUpload } = await import("../../lib/api-client");
const { MULTIPART_OVERHEAD_BYTES } = await import("../../lib/upload");
const { requestId } = await import("../../lib/request-id");
const riskUpload = await import("../../app/(app)/risks/[id]/evidence/route");
const taskUpload = await import("../../app/(app)/tasks/[id]/evidence/route");

const RISK = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TASK = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const CONTROL = "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d";
const CONTROL_2 = "8b9c0d1e-2f3a-4b4c-9d6e-7f8a9b0c1d2e";
const MAX = Number(testEnv.EVIDENCE_MAX_BYTES);
const BOUNDARY = "----isms-route-boundary";
const enc = new TextEncoder();
const PDF = enc.encode("%PDF-1.7\nhello evidence\n");

const evidence: EvidenceDto = {
  id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  fileName: "policy.pdf",
  sha256: "a".repeat(64),
  sizeBytes: PDF.length,
  mimeType: "application/pdf",
  classification: "internal",
  uploadedBy: { id: "u", displayName: "Carl Ciso" },
  collectedAt: "2026-11-05T00:00:00.000Z",
  controls: [{ code: "AST-01", title: "Asset inventory" }],
};

function multipart(
  fields: [string, string][],
  file: { name: string; type: string; bytes: Uint8Array } | null,
): Buffer {
  const parts: Uint8Array[] = fields.map(([k, v]) =>
    enc.encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  if (file)
    parts.push(
      enc.encode(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.bytes,
      enc.encode("\r\n"),
    );
  parts.push(enc.encode(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

/** A body that records whether anything read it. */
function watched(bytes: Uint8Array) {
  const state = { pulled: false };
  // highWaterMark 0: nothing is pulled until someone reads.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

function request(
  path: string,
  options: {
    origin?: string | null;
    length?: number;
    body?: ReadableStream<Uint8Array> | Buffer;
    requestId?: string;
  } = {},
): NextRequest {
  const headers = new Headers({ "content-type": `multipart/form-data; boundary=${BOUNDARY}` });
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost:3000");
  if (options.length !== undefined) headers.set("content-length", String(options.length));
  if (options.requestId) headers.set("x-request-id", options.requestId);
  const body = Buffer.isBuffer(options.body)
    ? new Blob([new Uint8Array(options.body)]).stream()
    : (options.body ?? null);
  // `duplex` is required for a streamed body but not in the DOM RequestInit type.
  const init = { method: "POST", headers, body, duplex: "half" } as ConstructorParameters<
    typeof NextRequest
  >[1];
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

const riskCtx = { params: Promise.resolve({ id: RISK }) };
const taskCtx = { params: Promise.resolve({ id: TASK }) };

/** What apiUpload was given, with the streamed file read to the end. */
async function sent() {
  const call = vi.mocked(apiUpload).mock.calls[0];
  if (!call) throw new Error("apiUpload was not called");
  const [route, params, query, stream, token, options] = call;
  return {
    route,
    params,
    query,
    token,
    options,
    bytes: await new Response(stream).arrayBuffer(),
  };
}

beforeEach(() => {
  vi.mocked(accessTokenFor).mockReset().mockResolvedValue({ ok: true, token: "token-1" });
  vi.mocked(apiUpload).mockReset();
});

describe("evidence upload routes", () => {
  it("the upload route refuses a foreign Origin", async () => {
    for (const origin of ["http://evil.test", "http://localhost:3001", null]) {
      const { stream, state } = watched(multipart([], { name: "a.pdf", type: "", bytes: PDF }));
      const res = await riskUpload.POST(
        request(`/risks/${RISK}/evidence`, { origin, body: stream }),
        riskCtx,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, kind: "forbidden" });
      expect(state.pulled).toBe(false);
    }
    expect(accessTokenFor).not.toHaveBeenCalled();
    expect(apiUpload).not.toHaveBeenCalled();
  });

  it("needs a session before reading the body", async () => {
    vi.mocked(accessTokenFor).mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: "/auth/login?returnTo=%2Frisks",
    });
    const { stream, state } = watched(multipart([], { name: "a.pdf", type: "", bytes: PDF }));
    const res = await riskUpload.POST(
      request(`/risks/${RISK}/evidence`, { body: stream }),
      riskCtx,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, kind: "signed-out" });
    expect(vi.mocked(accessTokenFor).mock.calls[0]?.[0]).toBe(`/risks/${RISK}`);
    expect(state.pulled).toBe(false);
  });

  it("the upload route refuses Content-Length above the limit before reading", async () => {
    const { stream, state } = watched(multipart([], { name: "a.pdf", type: "", bytes: PDF }));
    const res = await riskUpload.POST(
      request(`/risks/${RISK}/evidence`, {
        body: stream,
        length: MAX + MULTIPART_OVERHEAD_BYTES + 1,
      }),
      riskCtx,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, kind: "too-large" });
    expect(state.pulled).toBe(false);
    expect(apiUpload).not.toHaveBeenCalled();
  });

  it("refuses a file that grows past the limit while streaming", async () => {
    vi.mocked(apiUpload).mockImplementation(async (_r, _p, _q, stream) => {
      await new Response(stream).arrayBuffer();
      return evidence;
    });
    const big = multipart([["controlIds", CONTROL]], {
      name: "big.pdf",
      type: "application/pdf",
      bytes: new Uint8Array(MAX + 1),
    });
    const res = await riskUpload.POST(request(`/risks/${RISK}/evidence`, { body: big }), riskCtx);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, kind: "too-large" });
  });

  it("streams the file to the API with its name, type and fields, and returns the evidence", async () => {
    vi.mocked(apiUpload).mockResolvedValue(evidence);
    const raw = multipart(
      [
        ["classification", "confidential"],
        ["collectedAt", "2026-11-01"],
        ["controlIds", CONTROL],
        ["controlIds", CONTROL_2],
      ],
      { name: "policy.pdf", type: "application/octet-stream", bytes: PDF },
    );
    const res = await riskUpload.POST(
      request(`/risks/${RISK}/evidence`, { body: raw, length: raw.length }),
      riskCtx,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, data: evidence });
    const call = await sent();
    expect(call.route).toBe(evidenceRoutes.upload);
    expect(call.params).toEqual({ id: RISK });
    // The type follows the extension when the browser sends none the API knows.
    expect(call.query).toEqual({
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      classification: "confidential",
      collectedAt: "2026-11-01",
      controlIds: `${CONTROL},${CONTROL_2}`,
    });
    expect(call.token).toBe("token-1");
    expect(Buffer.from(call.bytes).equals(Buffer.from(PDF))).toBe(true);
  });

  it("never forwards a client-chosen request id: the API gets a fresh one", async () => {
    vi.mocked(apiUpload).mockResolvedValue(evidence);
    const chosen = "11111111-2222-4333-8444-555555555555";
    let inside: string | undefined;
    vi.mocked(accessTokenFor).mockImplementationOnce(async () => {
      inside = await requestId();
      return { ok: true, token: "token-1" };
    });
    const raw = multipart([["controlIds", CONTROL]], {
      name: "a.pdf",
      type: "application/pdf",
      bytes: PDF,
    });
    const res = await riskUpload.POST(
      request(`/risks/${RISK}/evidence`, { body: raw, requestId: chosen }),
      riskCtx,
    );
    expect(res.status).toBe(201);
    const { options } = await sent();
    expect(options.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(options.requestId).not.toBe(chosen);
    // The same id is used for this request's own logs and token lookup.
    expect(vi.mocked(accessTokenFor).mock.calls[0]?.[1]).toEqual({
      requestId: options.requestId,
    });
    // Code the upload reaches (a token refresh's log events) sees the same id.
    expect(inside).toBe(options.requestId);
  });

  it("refuses a second file part (or a field after the file) with 400", async () => {
    vi.mocked(apiUpload).mockImplementation(async (_r, _p, _q, stream) => {
      await new Response(stream).arrayBuffer();
      return evidence;
    });
    const first = multipart([["controlIds", CONTROL]], {
      name: "a.pdf",
      type: "application/pdf",
      bytes: PDF,
    });
    const raw = Buffer.concat([
      first.subarray(0, first.length - `--${BOUNDARY}--\r\n`.length),
      enc.encode(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="b.pdf"\r\n\r\n%PDF-\r\n--${BOUNDARY}--\r\n`,
      ),
    ]);
    const res = await riskUpload.POST(request(`/risks/${RISK}/evidence`, { body: raw }), riskCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      kind: "invalid",
      details: [{ path: "file", message: "extraParts" }],
    });
  });

  it("uploads for a task without controls", async () => {
    vi.mocked(apiUpload).mockResolvedValue(evidence);
    const raw = multipart([], { name: "list.csv", type: "text/csv", bytes: enc.encode("a,b\n") });
    const res = await taskUpload.POST(request(`/tasks/${TASK}/evidence`, { body: raw }), taskCtx);
    expect(res.status).toBe(201);
    const call = await sent();
    expect(call.route).toBe(evidenceRoutes.uploadForTask);
    expect(call.query).toEqual({
      fileName: "list.csv",
      mimeType: "text/csv",
      classification: "internal",
    });
    expect(vi.mocked(accessTokenFor).mock.calls[0]?.[0]).toBe("/tasks");
  });

  it("answers a missing file and an unknown type without calling the API", async () => {
    const none = multipart([["controlIds", CONTROL]], null);
    const res = await riskUpload.POST(request(`/risks/${RISK}/evidence`, { body: none }), riskCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      kind: "invalid",
      details: [{ path: "file", message: "empty" }],
    });

    const exe = multipart([["controlIds", CONTROL]], {
      name: "run.exe",
      type: "application/x-msdownload",
      bytes: PDF,
    });
    const refused = await riskUpload.POST(
      request(`/risks/${RISK}/evidence`, { body: exe }),
      riskCtx,
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      kind: "invalid",
      details: [{ path: "file", message: "evidenceTypeNotAllowed" }],
    });
    expect(apiUpload).not.toHaveBeenCalled();
  });

  it.each([
    [409, "CONFLICT", "controlNotAccepted", "conflict"],
    [409, "CONFLICT", "taskClosed", "conflict"],
    [400, "VALIDATION_FAILED", "file", "invalid"],
    [413, "PAYLOAD_TOO_LARGE", "file", "too-large"],
    [404, "NOT_FOUND", "x", "not-found"],
    [403, "FORBIDDEN", "x", "forbidden"],
  ] as const)("maps an API %i (%s) to %s", async (status, code, path, kind) => {
    vi.mocked(apiUpload).mockRejectedValue(
      new ApiError({
        status,
        code,
        message: "api text",
        details: [{ path, message: "evidenceTypeNotAllowed" }],
      }),
    );
    const raw = multipart([["controlIds", CONTROL]], {
      name: "a.pdf",
      type: "application/pdf",
      bytes: PDF,
    });
    const res = await riskUpload.POST(request(`/risks/${RISK}/evidence`, { body: raw }), riskCtx);
    expect(res.status).toBe(status);
    const json = (await res.json()) as { kind: string; details: unknown[] };
    expect(json.kind).toBe(kind);
    expect(JSON.stringify(json)).not.toContain("api text");
  });

  it("answers an id that is not a UUID with 404 before anything else", async () => {
    const res = await riskUpload.POST(request("/risks/x/evidence"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(404);
    expect(accessTokenFor).not.toHaveBeenCalled();
  });
});
