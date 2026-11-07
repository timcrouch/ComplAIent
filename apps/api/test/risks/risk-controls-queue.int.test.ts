import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MOCK_MODEL, sealSecret } from "@isms/ai";
import { randomBytes } from "node:crypto";
import type { RiskDetailDto } from "@isms/contracts";
import type { JobsClient } from "@isms/jobs";
import { AiModule } from "../../src/ai/index.js";
import { audits, db, detailPaths, reportBody, risksHarness } from "./harness.js";

const secretsKey = randomBytes(32);
/** A producer whose queue is down: every call fails at once. */
const downJobs = (): JobsClient => ({
  enqueue: () => Promise.reject(new Error("Redis is down")),
  schedule: () => Promise.reject(new Error("Redis is down")),
  removeFinished: () => Promise.reject(new Error("Redis is down")),
  close: () => Promise.resolve(),
});

const h = risksHarness({
  jobs: downJobs,
  imports: [AiModule.forRoot({ secretsKey, provider: "mock" })],
});
beforeAll(() => h.start());
beforeEach(() => h.reset());
afterAll(() => h.stop());

describe("risk control suggestions when the queue is down", () => {
  it("marks the risk failed/unavailable and answers 409 aiUnavailable.unavailable", async () => {
    await db.aiSettings.create({
      data: {
        enabled: true,
        sealedKey: new Uint8Array(sealSecret("sk-or-test-only-queue-0000", secretsKey)),
        keyLast4: "0000",
        keySetById: h.userIds.admin,
        keySetAt: new Date(),
        models: { controls: MOCK_MODEL.id },
      },
    });
    const created = await h.post("/api/v1/risks", reportBody(), "rita");
    const risk = created.body as RiskDetailDto;
    const res = await h.post(
      `/api/v1/risks/${risk.id}/control-suggestions`,
      { expectedVersion: 1 },
      "cora",
    );
    // The plain "add them by hand" message, not a generic server error.
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.unavailable"]);
    const row = await db.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(row.controlSuggestion).toBe("failed");
    expect(row.controlSuggestionFailure).toBe("unavailable");
    expect((await audits("risk.control_suggestions_requested")).length).toBe(1);
    const detail = await h.get(`/api/v1/risks/${risk.id}`, "cora");
    expect((detail.body as RiskDetailDto).controlSuggestion).toEqual({
      status: "failed",
      failure: "unavailable",
    });
  });
});
