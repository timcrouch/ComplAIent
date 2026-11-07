import type { IncomingMessage } from "node:http";
import { DomainError } from "@isms/domain";

const OCTET_STREAM = "application/octet-stream";

/**
 * The file of an upload route. Nothing is read until a service calls `read()`, after the
 * guards and its own access checks, so a refused caller never makes the API buffer a body.
 */
export interface RawUpload {
  /** The whole body: 413 over the limit, 400 at `file`/`empty` for no bytes. Reads once. */
  read(): Promise<Buffer>;
}

export const fileEmpty = () =>
  new DomainError("VALIDATION_FAILED", "Request validation failed", [
    { path: "file", message: "empty" },
  ]);
/** The client is gone: there is nobody to answer, so this is an expected, quiet refusal. */
const clientGone = () =>
  new DomainError("VALIDATION_FAILED", "Request validation failed", [
    { path: "file", message: "aborted" },
  ]);
const tooLarge = () => new DomainError("PAYLOAD_TOO_LARGE", "The file is larger than allowed");

/** True when the request declares an octet-stream body (any other type is never read). */
export function isOctetStream(req: IncomingMessage): boolean {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  return type === OCTET_STREAM;
}

/** The declared Content-Length, or null when the body is chunked or the header is absent. */
export function declaredLength(req: IncomingMessage): number | null {
  const raw = req.headers["content-length"];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  // The stream may already be unable to deliver (the client left during the service's
  // checks): no further event would arrive, so settle now instead of waiting forever.
  if (req.destroyed || req.readableAborted) return Promise.reject(clientGone());
  if (req.readableEnded) return Promise.reject(fileEmpty());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("close", onClose);
      req.off("aborted", onClose);
    };
    // Over the limit, stop reading; the error filter closes the connection (no draining).
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        done();
        req.pause();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      done();
      if (size === 0) reject(fileEmpty());
      else resolve(Buffer.concat(chunks, size));
    };
    // A stream error here is the client's connection failing (reset, aborted).
    const onError = () => {
      done();
      reject(clientGone());
    };
    const onClose = () => {
      if (req.complete) return;
      done();
      reject(clientGone());
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
    req.on("aborted", onClose);
  });
}

/**
 * Checks what can be checked without reading: a declared length over the limit is 413 at
 * once. The body itself is read only by `read()`.
 */
export function rawUpload(req: IncomingMessage, limit: number): RawUpload {
  const declared = declaredLength(req);
  if (declared !== null && declared > limit) throw tooLarge();
  let pending: Promise<Buffer> | undefined;
  return {
    read: () => {
      if (declared === 0 || !isOctetStream(req)) return Promise.reject(fileEmpty());
      pending ??= readBody(req, limit);
      return pending;
    },
  };
}
