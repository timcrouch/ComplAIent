import { evidenceRoutes } from "@isms/contracts";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiDownload } from "../../../../../lib/api-client";
import { redirectTo } from "../../../../../lib/auth-responses";
import { accessTokenFor, failureOf } from "../../../../../lib/server-api";
import messages from "../../../../../messages/index";

export const dynamic = "force-dynamic";

const t = messages.evidence.download;

/** The API's download headers that are passed on; nothing else (no cookies) is. */
const PASSED = [
  "content-type",
  "content-length",
  "content-disposition",
  "x-content-type-options",
  "x-evidence-sha256",
  "cache-control",
] as const;

const plain = (status: 404 | 503, text: string) =>
  new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * Errors the stream unless exactly `expected` bytes came through: the API cuts a download
 * short when the stored file fails its hash check, and that must never look like a whole file.
 */
function exactLength(expected: number): TransformStream<Uint8Array, Uint8Array> {
  let size = 0;
  return new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > expected) controller.error(new Error("Download longer than declared"));
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (size !== expected) controller.error(new Error("Download shorter than declared"));
    },
  });
}

/**
 * GET /evidence/{id}/download: the file as an attachment, streamed from the API with its
 * SHA-256 header. The API decides who may download it (a viewer of its risk, or the assignee
 * of the task it completed); anyone else gets the same 404 as for a file that does not exist.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return plain(404, t.notFound);
  const returnTo = `/evidence/${id}/download`;
  const token = await accessTokenFor(returnTo);
  let failure = token.ok ? null : token;
  if (token.ok) {
    try {
      const upstream = await apiDownload(evidenceRoutes.download, { id }, token.token);
      const headers = new Headers();
      for (const name of PASSED) {
        const value = upstream.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      // The API always declares the length; without it a cut-off file could not be told apart.
      const declared = upstream.headers.get("content-length");
      const length = declared === null ? Number.NaN : Number(declared);
      if (!upstream.body || !Number.isSafeInteger(length)) {
        void upstream.body?.cancel().catch(() => undefined);
        return plain(503, t.unavailable);
      }
      return new Response(upstream.body.pipeThrough(exactLength(length)), {
        status: 200,
        headers,
      });
    } catch (err) {
      failure = await failureOf(err, evidenceRoutes.download, returnTo);
    }
  }
  switch (failure?.kind) {
    case "signed-out":
    case "reauth":
      return redirectTo(failure.href ?? returnTo);
    case "forbidden":
    case "not-found":
      return plain(404, t.notFound);
    default:
      return plain(503, t.unavailable);
  }
}
