import { randomBytes } from "node:crypto";
import { MOCK_MODEL, sealSecret } from "@isms/ai";
import type { ControlOperationDto, ControlTestStepsResponse } from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiModule } from "../../src/ai/index.js";
import { LibraryModule } from "../../src/library/index.js";
import { type Who, db, detailPaths, risksHarness } from "../risks/harness.js";

const secretsKey = randomBytes(32);

describe("control test steps", () => {
  const h = risksHarness({
    imports: [LibraryModule, AiModule.forRoot({ secretsKey, provider: "mock" })],
  });
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await db.control.create({
      data: {
        code: "AST-01",
        title: "Asset inventory",
        description: "Keep a list of assets.",
        guidance: ["List laptops."],
        category: "assets",
        libraryVersion: "test",
      },
    });
  });
  afterAll(() => h.stop());

  async function enableAi(enabled = true): Promise<void> {
    await db.aiSettings.create({
      data: {
        enabled,
        sealedKey: new Uint8Array(sealSecret("sk-or-test-only-steps-0000", secretsKey)),
        keyLast4: "0000",
        keySetById: h.userIds.admin,
        keySetAt: new Date(),
        models: { controls: MOCK_MODEL.id },
      },
    });
  }

  const steps = (who: Who = "cora", code = "AST-01") =>
    h.post(`/api/v1/library/controls/${code}/test-steps`, {}, who);
  const operation = async (who: Who) =>
    (await h.get("/api/v1/library/controls/AST-01/operation", who)).body as ControlOperationDto;

  it("suggests 3-7 steps for a control and records the interaction", async () => {
    await enableAi();
    const res = await steps();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as ControlTestStepsResponse;
    expect(body.steps.length).toBeGreaterThanOrEqual(3);
    expect(body.steps.length).toBeLessThanOrEqual(7);
    expect(body.steps.join(" ")).toContain("AST-01");
    const interaction = await db.aiInteraction.findUniqueOrThrow({
      where: { id: body.interactionId },
    });
    expect(interaction).toMatchObject({
      purpose: "control_test_steps",
      actorUserId: h.userIds.cora,
      objectType: "Control",
    });
  });

  it("gives 409 aiUnavailable when AI is off, and 404 for an unknown control", async () => {
    await enableAi(false);
    const res = await steps();
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.disabled"]);
    expect((await steps("cora", "AST-99")).status).toBe(404);
  });

  it("forbids a contributor and an auditor", async () => {
    await enableAi();
    expect((await steps("rita")).status).toBe(403);
    expect((await steps("aldo")).status).toBe(403);
    expect(await db.aiInteraction.count()).toBe(0);
  });

  it("offers suggested steps only when AI is ready and the viewer can record tests", async () => {
    expect((await operation("cora")).canSuggestSteps).toBe(false);
    await enableAi();
    expect((await operation("cora")).canSuggestSteps).toBe(true);
    expect((await operation("aldo")).canSuggestSteps).toBe(false);
  });
});
