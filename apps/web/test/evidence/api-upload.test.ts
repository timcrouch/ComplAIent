import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { evidenceRoutes } from "@isms/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RISK = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CONTROL = "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d";
const ID = "0d1e2f3a-4b5c-4d6e-8f7a-8b9c0d1e2f3a";

/** Answers 409 at once, as the API does when it refuses before reading the file. */
const received: { requestId: string | undefined; bytes: number }[] = [];
const server = createServer((req: IncomingMessage, res) => {
  const seen = { requestId: req.headers["x-request-id"] as string | undefined, bytes: 0 };
  received.push(seen);
  req.on("data", (chunk: Buffer) => {
    seen.bytes += chunk.length;
  });
  res.setHeader("connection", "close");
  res.writeHead(409, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        code: "CONFLICT",
        message: "x",
        requestId: ID,
        details: [{ path: "controlNotAccepted", message: "controlNotAccepted" }],
      },
    }),
  );
});

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("API_BASE_URL", `http://127.0.0.1:${String(port)}`);
});

afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

describe("apiUpload against a server that refuses before reading", () => {
  it("returns the API's refusal (not a network failure) while the file is still being sent, with our request id", async () => {
    const { ApiError, apiUpload } = await import("../../lib/api-client");
    let pulled = 0;
    // 64 MB, slowly: far more than the refusal waits for.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 2));
        pulled += 1;
        if (pulled > 1024) controller.close();
        else controller.enqueue(new Uint8Array(65_536));
      },
    });
    const call = apiUpload(
      evidenceRoutes.upload,
      { id: RISK },
      {
        fileName: "a.pdf",
        mimeType: "application/pdf",
        classification: "internal",
        controlIds: CONTROL,
      },
      body,
      "token-1",
      { requestId: ID },
    );
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({
      status: 409,
      details: [{ path: "controlNotAccepted", message: "controlNotAccepted" }],
    });
    expect(pulled).toBeLessThan(1024);
    expect(received.at(-1)?.requestId).toBe(ID);
  });
});
