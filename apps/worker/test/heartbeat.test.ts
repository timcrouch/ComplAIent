import { describe, expect, it } from "vitest";
import { heartbeat } from "../src/jobs/heartbeat.js";

describe("heartbeat job", () => {
  it("logs the beat time and resolves", async () => {
    const logs: Record<string, unknown>[] = [];
    await heartbeat({ at: "2026-11-03T10:00:00.000Z" }, { info: (obj) => logs.push(obj) });
    expect(logs).toEqual([{ job: "system.heartbeat", at: "2026-11-03T10:00:00.000Z" }]);
  });
});
