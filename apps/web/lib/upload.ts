import "server-only";
import { type EvidenceDto, type evidenceRoutes } from "@isms/contracts";
import { EVIDENCE_TYPES } from "@isms/domain";
import { z } from "zod";
import { ApiError, apiUpload } from "./api-client";
import { env } from "./env";
import { withRequestId } from "./request-id";
import { boundaryOf, MultipartError, readMultipart, type MultipartFile } from "./multipart";
import { accessTokenFor, failureOf, type CallFailureKind } from "./server-api";

/** Room for the multipart envelope (boundaries, part headers, the small fields). */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** The fields before the file must arrive within this; then the API call's own timer runs. */
export const FIELDS_DEADLINE_MS = 15_000;

type Detail = { path: string; message: string };

/** The JSON a BFF upload route answers with: `CallResult`, plus "too-large" (413). */
export type UploadResult =
  | { ok: true; data: EvidenceDto }
  | { ok: false; kind: CallFailureKind | "too-large"; details: Detail[]; href?: string };

type UploadRoute = typeof evidenceRoutes.upload | typeof evidenceRoutes.uploadForTask;

const STATUS: Record<Exclude<UploadResult, { ok: true }>["kind"], number> = {
  "signed-out": 401,
  reauth: 401,
  forbidden: 403,
  "not-found": 404,
  invalid: 400,
  conflict: 409,
  "too-large": 413,
  unavailable: 503,
};

const NO_STORE = { "cache-control": "no-store" } as const;

function answer(result: UploadResult): Response {
  return Response.json(result, {
    status: result.ok ? 201 : STATUS[result.kind],
    headers: NO_STORE,
  });
}

const refuse = (kind: Exclude<UploadResult, { ok: true }>["kind"], details: Detail[] = []) =>
  answer({ ok: false, kind, details });
const fileProblem = (message: string) => refuse("invalid", [{ path: "file", message }]);

/** CSRF: the browser's Origin must be this app's own (WEB_BASE_URL). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(env().WEB_BASE_URL).origin;
}

/**
 * The declared type when it is one the API accepts, else the type its extension names; the API
 * still checks the bytes. Null when neither is allowed.
 */
export function mimeTypeFor(file: Pick<MultipartFile, "fileName" | "contentType">): string | null {
  const declared = file.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (Object.hasOwn(EVIDENCE_TYPES, declared)) return declared;
  const extension = file.fileName.toLowerCase().split(".").at(-1) ?? "";
  const match = Object.entries(EVIDENCE_TYPES).find(([, t]) => t.extensions.includes(extension));
  return match?.[0] ?? null;
}

/** Passes the bytes on, erroring once more than `max` have gone through. */
function limited(stream: ReadableStream<Uint8Array>, max: number) {
  const state = { exceeded: false };
  let size = 0;
  const out = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > max) {
          state.exceeded = true;
          controller.error(new MultipartError("tooLarge"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream: out, state };
}

export type UploadFields = { fields: Map<string, string[]>; fileName: string; mimeType: string };

/**
 * A file upload through the BFF: `multipart/form-data` with one `file`, streamed on to the
 * API as its octet-stream body. In order, before any of the body is read: the Origin (403),
 * the id (404), the session (401) and the declared length (413). The fields come before the
 * file, which must be the last part; the size is counted again while streaming. The upload
 * gets a fresh request id here (for everything it calls, through `withRequestId`): these
 * routes skip the proxy, so an inbound `x-request-id` is the client's and is never forwarded
 * or logged. Tokens and file bytes are never logged.
 */
export function handleUpload(request: Request, spec: UploadSpec): Promise<Response> {
  const requestId = crypto.randomUUID();
  return withRequestId(requestId, () => forward(request, spec, requestId));
}

type UploadSpec = {
  route: UploadRoute;
  id: string;
  returnTo: string;
  query: (input: UploadFields) => Record<string, string>;
};

async function forward(request: Request, spec: UploadSpec, requestId: string): Promise<Response> {
  if (!sameOrigin(request)) return refuse("forbidden");
  if (!z.uuid().safeParse(spec.id).success) return refuse("not-found");
  const token = await accessTokenFor(spec.returnTo, { requestId });
  if (!token.ok) return answer(token);

  const max = env().EVIDENCE_MAX_BYTES;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max + MULTIPART_OVERHEAD_BYTES) return refuse("too-large");
  const boundary = boundaryOf(request.headers.get("content-type"));
  if (!boundary || !request.body) return fileProblem("unreadable");

  let upload: { stream: ReadableStream<Uint8Array>; state: { exceeded: boolean } };
  let parsed: MultipartFile;
  let query: Record<string, string>;
  try {
    const { fields, file } = await readMultipart(request.body, boundary, {
      fieldsDeadlineMs: FIELDS_DEADLINE_MS,
    });
    if (!file || file.fileName === "") return fileProblem("empty");
    parsed = file;
    const mimeType = mimeTypeFor(file);
    if (!mimeType) {
      void file.stream.cancel().catch(() => undefined);
      return fileProblem("evidenceTypeNotAllowed");
    }
    query = spec.query({ fields, fileName: file.fileName, mimeType });
    const checked = spec.route.request.query.safeParse(query);
    if (!checked.success) {
      void file.stream.cancel().catch(() => undefined);
      return refuse(
        "invalid",
        checked.error.issues.map((i) => ({
          path: i.path.map(String).join("."),
          message: i.message,
        })),
      );
    }
    upload = limited(file.stream, max);
  } catch (err) {
    // A malformed or too slow body, or the browser went away while sending it.
    if (err instanceof MultipartError)
      return fileProblem(err.reason === "timeout" ? "timeout" : "unreadable");
    return fileProblem("aborted");
  }

  try {
    const data = await apiUpload(
      spec.route,
      { id: spec.id },
      query as never,
      upload.stream,
      token.token,
      { requestId },
    );
    return answer({ ok: true, data });
  } catch (err) {
    if (upload.state.exceeded) return refuse("too-large");
    const failure = parsed.failure();
    if (failure) return fileProblem(failure.reason === "extraParts" ? "extraParts" : "unreadable");
    if (err instanceof ApiError && err.status === 413) return refuse("too-large");
    return answer(await failureOf(err, spec.route, spec.returnTo, { requestId }));
  }
}

/** The first value of a field, or undefined. */
export const fieldValue = (fields: Map<string, string[]>, name: string): string | undefined =>
  fields.get(name)?.[0];
