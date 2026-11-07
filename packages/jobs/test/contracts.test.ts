import { describe, expect, it } from "vitest";
import { JobContracts, jobIdFor } from "../src/index.js";

describe("job contracts", () => {
  it("accepts an ISO timestamp for system.heartbeat and rejects anything else", () => {
    const schema = JobContracts["system.heartbeat"];
    expect(schema.safeParse({ at: "2026-11-03T10:00:00.000Z" }).success).toBe(true);
    expect(schema.safeParse({ at: "nope" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("validates the library.embed and risk.suggest_controls payloads", () => {
    expect(
      JobContracts["library.embed"].safeParse({ requestedAt: "2026-11-05T10:00:00.000Z" }).success,
    ).toBe(true);
    expect(JobContracts["library.embed"].safeParse({}).success).toBe(false);
    const suggest = JobContracts["risk.suggest_controls"];
    const valid = {
      riskId: "019a0000-0000-7000-8000-000000000001",
      requestedById: "019a0000-0000-7000-8000-000000000002",
      version: 2,
    };
    expect(suggest.safeParse(valid).success).toBe(true);
    expect(suggest.safeParse({ ...valid, riskId: "r-1" }).success).toBe(false);
    expect(suggest.safeParse({ ...valid, version: 1.5 }).success).toBe(false);
  });

  it("builds job ids without the ':' BullMQ forbids", () => {
    expect(jobIdFor("system.heartbeat", "k1")).toBe("system.heartbeat__k1");
  });
});
