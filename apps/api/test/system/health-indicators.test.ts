import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectStore } from "../../src/evidence/index.js";
import { CHECK_TIMEOUT_MS, StorageHealthIndicator } from "../../src/system/health-indicators.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("StorageHealthIndicator", () => {
  it("cancels the HeadBucket request when the check times out", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const store = {
      head: (s?: AbortSignal) => {
        signal = s;
        return new Promise<void>(() => undefined);
      },
    } as unknown as ObjectStore;
    const check = new StorageHealthIndicator(store).check();
    const outcome = expect(check).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });
});
