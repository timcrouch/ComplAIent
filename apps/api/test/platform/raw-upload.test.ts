import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { rawUpload } from "../../src/platform/raw-upload.js";

const request = (headers: Record<string, string> = {}) => {
  const req = new IncomingMessage(new Socket());
  req.headers = { "content-type": "application/octet-stream", ...headers };
  return req;
};

/** Settles within 1 s, or reports that it hung. */
const settled = (p: Promise<unknown>) =>
  Promise.race([
    p.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) =>
      setTimeout(() => {
        resolve("hung");
      }, 1000),
    ),
  ]);

describe("rawUpload", () => {
  it("reads the whole body", async () => {
    const req = request();
    const read = rawUpload(req, 100).read();
    req.push(Buffer.from("hello "));
    req.push(Buffer.from("world"));
    req.complete = true;
    req.push(null);
    expect((await read).toString()).toBe("hello world");
  });

  it("rejects at once when the client is already gone before reading starts", async () => {
    const req = request({ "content-length": "50" });
    req.destroy();
    expect(await settled(rawUpload(req, 100).read())).toBe("rejected");
  });

  it("rejects when the client disconnects during reading", async () => {
    const req = request({ "content-length": "50" });
    const read = rawUpload(req, 100).read();
    req.push(Buffer.from("partial"));
    req.destroy();
    expect(await settled(read)).toBe("rejected");
  });

  it("rejects a stream that already ended without delivering data", async () => {
    const req = request();
    req.push(null);
    req.resume();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await settled(rawUpload(req, 100).read())).toBe("rejected");
  });
});
