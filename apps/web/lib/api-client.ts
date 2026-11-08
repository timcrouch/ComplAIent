import "server-only";
import { ErrorResponse, type RouteDef } from "@isms/contracts";
import type { z, ZodType } from "zod";
import { env } from "./env";
import { REQUEST_ID_HEADER, requestId } from "./request-id";

const TIMEOUT_MS = 10_000;
/** The largest API body the BFF reads (the library export is the biggest, well below this). */
export const MAX_RESPONSE_BYTES = 5_000_000;

type ErrorCode = ErrorResponse["error"]["code"];
type Detail = { path: string; message: string };

/**
 * An API call that did not produce a contract-valid 2xx response. `status` is the HTTP status,
 * or 0 when no response was received (invalid input, timeout, network failure).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly details: Detail[] | undefined;

  constructor(init: {
    status: number;
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: Detail[];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? "";
    this.details = init.details;
  }
}

/**
 * What may be logged about a failed call: the error class and, for an `ApiError`, the HTTP
 * status (0 when the API was not reached or timed out), the machine code and the API's
 * request id. Never the message, URL, details or token.
 */
export function errorLogFields(err: unknown): {
  errorName: string;
  status?: number;
  code?: string;
  apiRequestId?: string;
} {
  const errorName = err instanceof Error ? err.name : typeof err;
  if (!(err instanceof ApiError)) return { errorName };
  return {
    errorName,
    status: err.status,
    code: err.code,
    ...(err.requestId ? { apiRequestId: err.requestId } : {}),
  };
}

type Req<R extends RouteDef> = R extends { request: infer Q } ? Q : object;

/** `{ params?, query?, body? }`, with each key present exactly when the route declares it. */
export type RouteInput<R extends RouteDef> = {
  [K in keyof Req<R> as Req<R>[K] extends ZodType ? K : never]: Req<R>[K] extends ZodType
    ? z.input<Req<R>[K]>
    : never;
};

type SuccessStatus = 200 | 201 | 202 | 204;
type Responses<R extends RouteDef> = R["responses"];

/** The parsed body of any 2xx response the route declares. */
export type RouteOutput<R extends RouteDef> = {
  [S in Extract<keyof Responses<R>, SuccessStatus>]: Responses<R>[S] extends ZodType
    ? z.output<Responses<R>[S]>
    : never;
}[Extract<keyof Responses<R>, SuccessStatus>];

function parseInput(schema: ZodType | undefined, value: unknown, part: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError({
    status: 0,
    code: "VALIDATION_FAILED",
    message: `Request ${part} does not match the contract`,
    details: result.error.issues.map((i) => ({
      path: [part, ...i.path.map(String)].join("."),
      message: i.message,
    })),
  });
}

/** Path and query values must be scalars; objects would serialise as "[object Object]". */
function scalar(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  throw new ApiError({
    status: 0,
    code: "VALIDATION_FAILED",
    message: `Invalid value for ${name}`,
  });
}

const invalid = (message: string): ApiError =>
  new ApiError({ status: 0, code: "VALIDATION_FAILED", message });

/**
 * Builds `API_BASE_URL` path prefix + route path. Path params are URL-encoded; empty and
 * dot-only values ("." / "..") are rejected because URL parsing would treat them as dot
 * segments and silently retarget the request. As a backstop, the parsed pathname must equal
 * the substituted template exactly.
 */
function buildUrl(route: RouteDef, params: unknown, query: unknown): URL {
  const values = (params ?? {}) as Record<string, unknown>;
  const path = route.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = scalar(values[name], name);
    if (value === "" || /^\.+$/.test(value)) throw invalid(`Invalid value for ${name}`);
    return encodeURIComponent(value);
  });
  const base = new URL(env().API_BASE_URL);
  const expected = `${base.pathname.replace(/\/+$/, "")}${path}`;
  const url = new URL(base.origin);
  url.pathname = expected;
  if (url.pathname !== expected) throw invalid("Request path does not match the route");
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (item !== undefined && item !== null) {
        url.searchParams.append(key, scalar(item, key));
      }
    }
  }
  return url;
}

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Symbol("unparseable");
  }
}

type Received = { status: number; ok: boolean; payload: unknown };

const tooLarge = () =>
  new ApiError({ status: 0, code: "INTERNAL", message: "API response too large" });

/** Reads the body as UTF-8, stopping (and cancelling the stream) once it passes the cap. */
async function readCapped(res: Response): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw tooLarge();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Aborts `controller` after `ms`; the returned promise rejects when it does. */
function deadline(controller: AbortController, ms: number) {
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new Error("aborted"));
    });
  });
  aborted.catch(() => undefined);
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  return {
    aborted,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

// The cause may embed the URL; keep the error generic.
const failed = (timedOut: boolean) =>
  new ApiError({
    status: 0,
    code: "INTERNAL",
    message: timedOut ? "API request timed out" : "API request failed",
  });

/** One timeout covers the whole exchange: connecting, headers and reading the body. */
async function send(url: URL, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Received> {
  const controller = new AbortController();
  const { aborted, clear } = deadline(controller, timeoutMs);
  let res: Response | undefined;
  try {
    res = await Promise.race([fetch(url, { ...init, signal: controller.signal }), aborted]);
    const text = await Promise.race([readCapped(res), aborted]);
    return { status: res.status, ok: res.ok, payload: parseJson(text) };
  } catch (err) {
    void res?.body?.cancel().catch(() => undefined);
    if (err instanceof ApiError) throw err;
    throw failed(controller.signal.aborted);
  } finally {
    clear();
  }
}

/** An `ApiError` for a non-2xx answer, from the error body when it is contract-valid. */
function errorFrom(status: number, payload: unknown): ApiError {
  const parsed = ErrorResponse.safeParse(payload);
  if (!parsed.success) {
    return new ApiError({ status, code: "INTERNAL", message: "Unexpected API error" });
  }
  const { details, ...error } = parsed.data.error;
  return new ApiError({ status, ...error, ...(details ? { details } : {}) });
}

/** The 2xx body parsed with the route's response schema; everything else is an `ApiError`. */
function outputOf<R extends RouteDef>(route: R, res: Received): RouteOutput<R> {
  if (!res.ok) throw errorFrom(res.status, res.payload);
  const schema = route.responses[res.status];
  const result = schema?.safeParse(res.payload);
  if (!result?.success) {
    throw new ApiError({
      status: res.status,
      code: "INTERNAL",
      message: "API response does not match the contract",
    });
  }
  return result.data as RouteOutput<R>;
}

async function baseHeaders(accessToken: string, accept: string, id?: string): Promise<Headers> {
  return new Headers({
    authorization: `Bearer ${accessToken}`,
    accept,
    [REQUEST_ID_HEADER]: id ?? (await requestId()),
  });
}

/**
 * Typed call to a contract route: validates the input, sends `Authorization: Bearer` and the
 * BFF request id (`x-request-id`), parses
 * the 2xx body with the route's response schema, and maps everything else to `ApiError`.
 */
export async function apiCall<R extends RouteDef>(
  route: R,
  input: RouteInput<R>,
  accessToken: string,
): Promise<RouteOutput<R>> {
  const raw = input as { params?: unknown; query?: unknown; body?: unknown };
  const params = parseInput(route.request?.params, raw.params ?? {}, "params");
  const query = parseInput(route.request?.query, raw.query ?? {}, "query");
  const body = parseInput(route.request?.body, raw.body, "body");

  const headers = await baseHeaders(accessToken, "application/json");
  if (route.request?.body) headers.set("content-type", "application/json");
  const res = await send(buildUrl(route, params, query), {
    method: route.method.toUpperCase(),
    headers,
    cache: "no-store",
    // A redirect could carry the bearer token elsewhere; the API never redirects.
    redirect: "error",
    ...(route.request?.body ? { body: JSON.stringify(body) } : {}),
  });
  return outputOf(route, res);
}

/** Long enough for the largest allowed file on a slow link; the API limits the size. */
const UPLOAD_TIMEOUT_MS = 300_000;

type UploadRoute = RouteDef & { upload: NonNullable<RouteDef["upload"]> };
type DownloadRoute = RouteDef & { download: true };
type ParamsOf<R extends RouteDef> = RouteInput<R> extends { params: infer P } ? P : never;
type QueryOf<R extends RouteDef> = RouteInput<R> extends { query: infer Q } ? Q : never;

/**
 * Streams a file to an upload route as its `application/octet-stream` body. The query is
 * checked against the contract but sent as given (its parsed form may be transformed, such as
 * comma-separated ids split into a list). The JSON answer is handled as in `apiCall`.
 * `requestId` is the BFF's own id for this upload: upload routes skip the proxy, so the
 * inbound `x-request-id` is the client's and must never reach the API (or its audit rows).
 */
export async function apiUpload<R extends UploadRoute>(
  route: R,
  params: ParamsOf<R>,
  query: QueryOf<R>,
  body: ReadableStream<Uint8Array>,
  accessToken: string,
  options: { requestId: string },
): Promise<RouteOutput<R>> {
  const checkedParams = parseInput(route.request?.params, params, "params");
  parseInput(route.request?.query, query, "query");
  const headers = await baseHeaders(accessToken, "application/json", options.requestId);
  headers.set("content-type", "application/octet-stream");
  const res = await send(
    buildUrl(route, checkedParams, query),
    {
      method: route.method.toUpperCase(),
      headers,
      cache: "no-store",
      redirect: "error",
      body,
      duplex: "half",
    } as RequestInit,
    UPLOAD_TIMEOUT_MS,
  );
  return outputOf(route, res);
}

/**
 * Opens a download route and returns the API's response once its headers arrive, to be
 * streamed on without a size cap. A query is checked against the contract and sent as given.
 * The timeout covers reaching the headers only. A non-2xx answer becomes an `ApiError` (its
 * small JSON body is read under the usual cap).
 * `requestId`, when given, is sent instead of `requestId()`. A route the proxy skips (such as
 * the report files, whose paths end in an extension) passes its own id, as `apiUpload` does.
 */
export async function apiDownload<R extends DownloadRoute>(
  route: R,
  params: [ParamsOf<R>] extends [never] ? Record<string, never> : ParamsOf<R>,
  accessToken: string,
  query?: QueryOf<R>,
  options: { requestId?: string } = {},
): Promise<Response> {
  const checkedParams = parseInput(route.request?.params, params, "params");
  parseInput(route.request?.query, query ?? {}, "query");
  const controller = new AbortController();
  const { aborted, clear } = deadline(controller, TIMEOUT_MS);
  let res: Response;
  try {
    res = await Promise.race([
      fetch(buildUrl(route, checkedParams, query ?? {}), {
        method: "GET",
        headers: await baseHeaders(accessToken, "*/*", options.requestId),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      }),
      aborted,
    ]);
  } catch (err) {
    clear();
    if (err instanceof ApiError) throw err;
    throw failed(controller.signal.aborted);
  }
  if (res.ok) {
    // The body may take longer than the timeout; only reaching the headers is timed.
    clear();
    return res;
  }
  try {
    const text = await Promise.race([readCapped(res), aborted]);
    throw errorFrom(res.status, parseJson(text));
  } catch (err) {
    void res.body?.cancel().catch(() => undefined);
    if (err instanceof ApiError) throw err;
    throw failed(controller.signal.aborted);
  } finally {
    clear();
  }
}
