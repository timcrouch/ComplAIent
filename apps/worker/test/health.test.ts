import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer } from "../src/health.js";

describe("health server", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function start(): Promise<string> {
    const server = await startHealthServer(0);
    close = () => server.close();
    return `http://127.0.0.1:${String(server.address().port)}`;
  }

  it("answers GET /healthz with 200", async () => {
    const res = await fetch(`${await start()}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers anything else with 404", async () => {
    const base = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(404);
  });
});
