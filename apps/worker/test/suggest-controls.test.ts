import type { SuggestControlsDeps } from "@isms/ai";
import { describe, expect, it } from "vitest";
import { suggestControls } from "../src/jobs/suggest-controls.js";

const RISK_ID = "019a0000-0000-7000-8000-000000000001";
const USER_ID = "019a0000-0000-7000-8000-000000000002";

describe("risk.suggest_controls failure handling", () => {
  it("rethrows the original error and logs when marking the risk failed also fails", async () => {
    const original = new Error("database went away");
    const db = {
      risk: {
        findUnique: () => Promise.reject(original),
        updateMany: () => Promise.reject(new Error("still away")),
      },
    } as unknown as SuggestControlsDeps["db"];
    const errors: Record<string, unknown>[] = [];
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: (obj: Record<string, unknown>) => errors.push(obj),
    };
    const deps = {
      db,
      logger,
      embedder: {} as SuggestControlsDeps["embedder"],
      gateway: {} as SuggestControlsDeps["gateway"],
    };

    await expect(
      suggestControls(
        deps,
        { riskId: RISK_ID, requestedById: USER_ID, version: 1 },
        { attempt: 5, maxAttempts: 5 },
      ),
    ).rejects.toBe(original);
    expect(errors).toEqual([{ job: "risk.suggest_controls", errName: "Error" }]);
  });
});
