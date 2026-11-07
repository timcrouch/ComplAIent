import { describe, expect, it } from "vitest";
import { boundaryOf, MultipartError, readMultipart } from "../../lib/multipart";

const BOUNDARY = "----isms-test-boundary";
const enc = new TextEncoder();

function body(
  parts: string[],
  file?: { name: string; type: string; bytes: Uint8Array },
): Uint8Array {
  const chunks: Uint8Array[] = parts.map((p) => enc.encode(p));
  if (file) {
    chunks.push(
      enc.encode(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.bytes,
      enc.encode(`\r\n--${BOUNDARY}--\r\n`),
    );
  }
  return Buffer.concat(chunks);
}

const field = (name: string, value: string) =>
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

/** The bytes as a stream of chunks of `size`, to cross the boundary at awkward places. */
function streamOf(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("multipart", () => {
  it("reads the boundary from the content type", () => {
    expect(boundaryOf(`multipart/form-data; boundary=${BOUNDARY}`)).toBe(BOUNDARY);
    expect(boundaryOf(`multipart/form-data; boundary="${BOUNDARY}"`)).toBe(BOUNDARY);
    expect(boundaryOf("application/json")).toBeNull();
    expect(boundaryOf(null)).toBeNull();
  });

  it.each([1, 3, 7, 64, 100_000])(
    "streams the file part exactly, in chunks of %i bytes",
    async (size) => {
      const bytes = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
      // Bytes that look like the start of a delimiter must stay in the file.
      bytes.set(enc.encode(`\r\n--${BOUNDARY.slice(0, 10)}`), 1000);
      const raw = body([field("classification", "internal"), field("controlIds", "a")], {
        name: "policy.pdf",
        type: "application/pdf",
        bytes,
      });
      const { fields, file } = await readMultipart(streamOf(raw, size), BOUNDARY);
      expect(fields.get("classification")).toEqual(["internal"]);
      expect(fields.get("controlIds")).toEqual(["a"]);
      expect(file?.fileName).toBe("policy.pdf");
      expect(file?.contentType).toBe("application/pdf");
      if (!file) throw new Error("no file");
      expect(Buffer.from(await collect(file.stream)).equals(Buffer.from(bytes))).toBe(true);
    },
  );

  it("does not read past the fields until the file is consumed", async () => {
    let pulled = 0;
    const raw = body([field("a", "1")], {
      name: "x.txt",
      type: "text/plain",
      bytes: new Uint8Array(200_000),
    });
    const source = streamOf(raw, 1000);
    const reader = source.getReader();
    const counting = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else {
          pulled += 1;
          controller.enqueue(value);
        }
      },
    });
    const { file } = await readMultipart(counting, BOUNDARY);
    expect(file).not.toBeNull();
    expect(pulled).toBeLessThan(5);
  });

  it("returns no file when there is no file part", async () => {
    const raw = body([field("a", "1"), `--${BOUNDARY}--\r\n`]);
    const { file } = await readMultipart(streamOf(raw, 10), BOUNDARY);
    expect(file).toBeNull();
  });

  it("refuses a field that is too long and a body that is not multipart", async () => {
    const long = body([field("a", "x".repeat(10_000)), `--${BOUNDARY}--\r\n`]);
    await expect(readMultipart(streamOf(long, 100), BOUNDARY)).rejects.toBeInstanceOf(
      MultipartError,
    );
    await expect(
      readMultipart(streamOf(enc.encode("not multipart at all"), 5), BOUNDARY),
    ).rejects.toBeInstanceOf(MultipartError);
  });

  it("fails the file stream when anything follows the file part", async () => {
    const file = (name: string) =>
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nhello\r\n`;
    for (const after of [file("second.txt"), field("late", "x")]) {
      const raw = enc.encode(`${field("a", "1")}${file("first.txt")}${after}--${BOUNDARY}--\r\n`);
      const result = await readMultipart(streamOf(raw, 7), BOUNDARY);
      if (!result.file) throw new Error("no file");
      await expect(collect(result.file.stream)).rejects.toMatchObject({ reason: "extraParts" });
      expect(result.file.failure()?.reason).toBe("extraParts");
    }
  });

  it("gives up on fields that arrive too slowly", async () => {
    const first = enc.encode(field("a", "1").slice(0, 20));
    let sent = false;
    const slow = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(first);
        }
        // Then nothing more ever arrives.
        return new Promise(() => undefined);
      },
    });
    await expect(readMultipart(slow, BOUNDARY, { fieldsDeadlineMs: 50 })).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("fails the file stream when the body ends before the closing boundary", async () => {
    const raw = body([field("a", "1")], {
      name: "x.txt",
      type: "text/plain",
      bytes: enc.encode("hello"),
    });
    const cut = raw.slice(0, raw.length - BOUNDARY.length - 8);
    const { file } = await readMultipart(streamOf(cut, 4), BOUNDARY);
    if (!file) throw new Error("no file");
    await expect(collect(file.stream)).rejects.toBeInstanceOf(MultipartError);
  });
});
