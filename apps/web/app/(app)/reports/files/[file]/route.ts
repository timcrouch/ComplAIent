import { reportRoutes } from "@isms/contracts";
import type { NextRequest } from "next/server";
import { apiDownload } from "../../../../../lib/api-client";
import { redirectTo } from "../../../../../lib/auth-responses";
import { accessTokenFor, failureOf } from "../../../../../lib/server-api";
import messages from "../../../../../messages/index";

export const dynamic = "force-dynamic";

const t = messages.reports.files;

/** The only file names that pass (P7-R6), each with its API download route. */
const FILES = {
  "risk-register.xlsx": reportRoutes.registerXlsx,
  "risk-register.pdf": reportRoutes.registerPdf,
  "soa.xlsx": reportRoutes.soaXlsx,
  "soa.pdf": reportRoutes.soaPdf,
  "board.pdf": reportRoutes.boardPdf,
} as const;
type FileName = keyof typeof FILES;
const isFile = (name: string): name is FileName => Object.hasOwn(FILES, name);

/** The API's download headers that are passed on; nothing else (no cookies) is. */
const PASSED = [
  "content-type",
  "content-length",
  "content-disposition",
  "x-content-type-options",
  "cache-control",
] as const;

const plain = (status: 400 | 403 | 404 | 409 | 503, text: string) =>
  new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * GET /reports/files/{file}: a report file (XLSX or PDF) streamed from the API with the
 * viewer's token and the file's own query keys passed on (the register's filter and
 * includeClosed, the SoA's framework, the board's period); any other key is dropped. The API builds the file, applies risk visibility and audits it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  if (!isFile(file)) return plain(404, t.notFound);
  const route = FILES[file];
  const raw = request.nextUrl.searchParams;
  if (!route.request.query.safeParse(Object.fromEntries(raw)).success) {
    return plain(400, t.invalid);
  }
  // Only the file's own query keys are passed on (P7-R10); anything else in the URL is dropped.
  const query: Record<string, string> = {};
  for (const key of Object.keys(route.request.query.shape)) {
    const value = raw.get(key);
    if (value !== null) query[key] = value;
  }
  const search = new URLSearchParams(query).toString();
  const returnTo = `/reports/files/${file}${search === "" ? "" : `?${search}`}`;
  // The proxy skips paths with an extension, so the inbound x-request-id is the client's own:
  // this route makes its own id for the log, the API call and so the audit row.
  const options = { requestId: crypto.randomUUID() };
  const token = await accessTokenFor(returnTo, options);
  let failure = token.ok ? null : token;
  if (token.ok) {
    try {
      const upstream = await apiDownload(route, {}, token.token, query, options);
      if (!upstream.body) return plain(503, t.unavailable);
      const headers = new Headers();
      for (const name of PASSED) {
        const value = upstream.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      failure = await failureOf(err, route, returnTo, options);
    }
  }
  switch (failure?.kind) {
    case "signed-out":
    case "reauth":
      return redirectTo(failure.href ?? returnTo);
    case "forbidden":
      return plain(403, t.forbidden);
    case "not-found":
      return plain(404, t.notFound);
    case "invalid":
      return plain(400, t.invalid);
    case "conflict":
      return plain(409, t.tooLarge);
    default:
      return plain(503, t.unavailable);
  }
}
