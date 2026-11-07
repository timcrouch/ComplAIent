import { createHash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/** The bytes read from the store do not hash to the evidence's recorded SHA-256. */
export class EvidenceIntegrityError extends Error {
  override readonly name = "EvidenceIntegrityError";
}

/**
 * Passes the file through while hashing it, always holding back the latest chunk. Only when
 * the whole file hashes to `expectedSha256` is that chunk released; otherwise the stream
 * fails, so the client never receives the full Content-Length and sees a broken transfer.
 */
export class VerifyingStream extends Transform {
  private readonly hash = createHash("sha256");
  private held: Buffer | null = null;

  constructor(private readonly expectedSha256: string) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk);
    if (this.held !== null) this.push(this.held);
    this.held = chunk;
    callback();
  }

  override _flush(callback: TransformCallback): void {
    if (this.hash.digest("hex") !== this.expectedSha256) {
      callback(new EvidenceIntegrityError("The stored file does not match its hash"));
      return;
    }
    if (this.held !== null) this.push(this.held);
    callback();
  }
}
