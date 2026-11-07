/**
 * A small streaming reader for `multipart/form-data` (RFC 7578): the text fields before the
 * file are read into memory (each a few KB at most); the file itself is handed on as a
 * stream, so an upload is never held in memory whole. The file must be the last part: a
 * second file, or any field after it, fails the file stream ("extraParts").
 */

export class MultipartError extends Error {
  constructor(readonly reason: "malformed" | "tooLarge" | "extraParts" | "timeout") {
    super(`Multipart body ${reason}`);
    this.name = "MultipartError";
  }
}

export type MultipartFile = {
  /** As the browser sent it; the API keeps only a cleaned base name. */
  fileName: string;
  /** The part's Content-Type, or "" when it has none. */
  contentType: string;
  /**
   * The file's bytes; it errors with `MultipartError` if the body ends before the part does
   * or anything follows it.
   */
  stream: ReadableStream<Uint8Array>;
  /** Why the file stream failed, once it has; null while it is fine. */
  failure: () => MultipartError | null;
};

const MAX_PREAMBLE_BYTES = 1024;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FIELD_BYTES = 4 * 1024;
const MAX_FIELDS = 32;
const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/;

/** The boundary of a `multipart/form-data` content type, or null for any other type. */
export function boundaryOf(contentType: string | null): string | null {
  if (!contentType) return null;
  const [type, ...params] = contentType.split(";");
  if (type?.trim().toLowerCase() !== "multipart/form-data") return null;
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== "boundary") continue;
    let value = param.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    return BOUNDARY.test(value) ? value : null;
  }
  return null;
}

/** The bytes read so far and not yet consumed, over the body's reader. */
class Bytes {
  private buf: Buffer;
  private ended = false;
  /** Epoch ms by which the next chunk must arrive; null for no limit. */
  deadline: number | null = null;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    prefix: Buffer,
  ) {
    this.buf = prefix;
  }

  get length(): number {
    return this.buf.length;
  }

  indexOf(needle: Buffer): number {
    return this.buf.indexOf(needle);
  }

  /** Reads one more chunk; false at the end of the body. */
  async fill(): Promise<boolean> {
    if (this.ended) return false;
    const { done, value } = await this.read();
    if (done) {
      this.ended = true;
      return false;
    }
    this.buf = this.buf.length === 0 ? Buffer.from(value) : Buffer.concat([this.buf, value]);
    return true;
  }

  private async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (this.deadline === null) return this.reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          reject(new MultipartError("timeout"));
        },
        Math.max(0, this.deadline ?? 0) - Date.now(),
      );
    });
    try {
      return await Promise.race([this.reader.read(), late]);
    } catch (err) {
      if (err instanceof MultipartError) void this.reader.cancel(err).catch(() => undefined);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  take(n: number): Buffer {
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** The bytes before `needle`, consuming both; at most `max` bytes may come before it. */
  async until(needle: Buffer, max: number): Promise<Buffer> {
    for (;;) {
      const at = this.indexOf(needle);
      if (at !== -1 && at <= max) {
        const out = Buffer.from(this.take(at));
        this.take(needle.length);
        return out;
      }
      if (at !== -1 || this.length > max + needle.length) throw new MultipartError("tooLarge");
      if (!(await this.fill())) throw new MultipartError("malformed");
    }
  }

  /** Exactly `n` bytes. */
  async exactly(n: number): Promise<Buffer> {
    while (this.length < n) if (!(await this.fill())) throw new MultipartError("malformed");
    return Buffer.from(this.take(n));
  }

  cancel(reason?: unknown): Promise<void> {
    return this.reader.cancel(reason);
  }
}

type PartHeaders = { name: string; fileName: string | null; contentType: string };

const PARAM = /;\s*([A-Za-z0-9_*-]+)=(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;

function parseHeaders(block: Buffer): PartHeaders {
  let disposition = "";
  let contentType = "";
  for (const line of new TextDecoder().decode(block).split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "content-disposition") disposition = value;
    else if (name === "content-type") contentType = value;
  }
  if (!/^form-data\s*(;|$)/i.test(disposition)) throw new MultipartError("malformed");
  const params = new Map<string, string>();
  for (const m of disposition.matchAll(PARAM)) {
    const key = (m[1] ?? "").toLowerCase();
    params.set(key, m[2] === undefined ? (m[3] ?? "").trim() : m[2].replace(/\\(.)/g, "$1"));
  }
  const name = params.get("name");
  if (name === undefined) throw new MultipartError("malformed");
  return { name, fileName: params.get("filename") ?? null, contentType };
}

/** The rest of the file part, up to (not including) the next delimiter, which must be the last. */
function fileStream(bytes: Bytes, delimiter: Buffer) {
  let failure: MultipartError | null = null;
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: MultipartError) => {
    failure = error;
    controller.error(error);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const at = bytes.indexOf(delimiter);
        if (at !== -1) {
          if (at > 0) controller.enqueue(Buffer.from(bytes.take(at)));
          bytes.take(delimiter.length);
          // Only the closing "--" may follow: a second file or a late field is refused.
          try {
            if ((await bytes.exactly(2)).toString("latin1") !== "--") {
              fail(controller, new MultipartError("extraParts"));
              return;
            }
          } catch (err) {
            fail(controller, err instanceof MultipartError ? err : new MultipartError("malformed"));
            return;
          }
          controller.close();
          return;
        }
        // Keep enough back to recognise a delimiter split across chunks.
        const safe = bytes.length - (delimiter.length - 1);
        if (safe > 0) {
          controller.enqueue(Buffer.from(bytes.take(safe)));
          return;
        }
        if (!(await bytes.fill())) {
          fail(controller, new MultipartError("malformed"));
          return;
        }
      }
    },
    cancel(reason) {
      return bytes.cancel(reason);
    },
  });
  return { stream, failure: () => failure };
}

/**
 * Reads the text fields up to the part named `fileField` and returns them with that part as a
 * stream; fields after it are not read. `file` is null when the body has no such part.
 */
export async function readMultipart(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  options: { fileField?: string; fieldsDeadlineMs?: number } = {},
): Promise<{ fields: Map<string, string[]>; file: MultipartFile | null }> {
  const fileField = options.fileField ?? "file";
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  // A leading CRLF lets the first boundary match the same delimiter as every later one.
  const bytes = new Bytes(body.getReader(), Buffer.from(CRLF));
  // Everything up to the file's own headers must arrive in time (slow-loris); the file's
  // bytes are then timed by the call that sends them on.
  if (options.fieldsDeadlineMs !== undefined)
    bytes.deadline = Date.now() + options.fieldsDeadlineMs;
  const fields = new Map<string, string[]>();
  await bytes.until(delimiter, MAX_PREAMBLE_BYTES);
  for (let count = 0; ; count += 1) {
    const after = await bytes.exactly(2);
    if (after.toString("latin1") === "--") return { fields, file: null };
    if (!after.equals(CRLF) || count >= MAX_FIELDS) throw new MultipartError("malformed");
    const headers = parseHeaders(await bytes.until(HEADER_END, MAX_HEADER_BYTES));
    if (headers.name === fileField && headers.fileName !== null) {
      bytes.deadline = null;
      return {
        fields,
        file: {
          fileName: headers.fileName,
          contentType: headers.contentType,
          ...fileStream(bytes, delimiter),
        },
      };
    }
    const value = await bytes.until(delimiter, MAX_FIELD_BYTES);
    fields.set(headers.name, [...(fields.get(headers.name) ?? []), value.toString("utf8")]);
  }
}
