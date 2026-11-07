import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { KEY, OTHER_KEY, aiHarness, db, newSecretsKey } from "./harness.js";

// Own file: nestjs-pino keeps one process-wide root logger, so a log destination can only
// be chosen by the first application built in a test file.
let output = "";
const destination = new Writable({
  write(chunk: Buffer, _enc, cb) {
    output += chunk.toString();
    cb();
  },
});
const h = aiHarness({
  secretsKey: newSecretsKey(),
  logLevel: "debug",
  logDestination: destination,
});
const BASE = "/api/v1/settings/ai";

beforeAll(async () => {
  await h.start();
  await h.reset();
});
afterAll(async () => {
  await h.stop();
  await db.$disconnect();
});

describe("AI settings logging", () => {
  it("the key never appears in captured log output", async () => {
    expect((await h.put(`${BASE}/key`, { key: KEY })).status).toBe(200);
    expect((await h.put(`${BASE}/key`, { key: OTHER_KEY })).status).toBe(200);
    expect((await h.put(`${BASE}/key`, { key: `${KEY} x` })).status).toBe(400);
    expect((await h.put(`${BASE}/key`, { key: KEY }, { authAge: 600 })).status).toBe(403);
    expect((await h.post(`${BASE}/test`)).status).toBe(200);
    expect((await h.get(`${BASE}/models`)).status).toBe(200);
    expect((await h.delete(`${BASE}/key`)).status).toBe(200);
    await vi.waitFor(() => {
      expect(output.match(/request completed/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    });
    expect(output).toContain("/api/v1/settings/ai/key");
    for (const secret of [KEY, OTHER_KEY]) {
      expect(output).not.toContain(secret.slice(0, 12));
      expect(output).not.toContain(secret.slice(-16));
    }
  });
});
