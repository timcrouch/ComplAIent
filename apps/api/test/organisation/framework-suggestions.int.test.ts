import { randomBytes } from "node:crypto";
import {
  MOCK_MODEL,
  type AiProvider,
  type CompletionRequest,
  createMockProvider,
  sealSecret,
} from "@isms/ai";
import type { FrameworksResponse } from "@isms/contracts";
import { syncControlLibrary } from "@isms/control-library";
import { FIXTURE_LIBRARY } from "@isms/control-library/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiGatewayService, AiModule } from "../../src/ai/index.js";
import { type Who, audits, db, detailPaths, risksHarness } from "../risks/harness.js";

const secretsKey = randomBytes(32);
/** The provider seam: null uses the mock's default replies. */
let script: ((request: CompletionRequest) => string) | null = null;
const requests: CompletionRequest[] = [];

function recordingProvider(): AiProvider {
  const inner = createMockProvider(script ? { script } : {});
  return {
    ...inner,
    complete(req) {
      requests.push(req);
      return inner.complete(req);
    },
  };
}

const h = risksHarness({
  imports: [
    AiModule.forRoot({
      secretsKey,
      provider: "mock",
      providerFactory: recordingProvider,
    }),
  ],
});
const versionIds = {} as Record<"iso" | "gdpr", string>;
const REASONING = "Suggested from your answers — please check.";

beforeAll(() => h.start());
beforeEach(async () => {
  script = null;
  requests.length = 0;
  await h.reset();
  await syncControlLibrary(db, FIXTURE_LIBRARY);
  for (const [name, key] of [
    ["iso", "iso27001-2022"],
    ["gdpr", "gdpr-2016-679"],
  ] as const)
    versionIds[name] = (await db.frameworkVersion.findUniqueOrThrow({ where: { key } })).id;
  await db.organisation.create({
    data: {
      name: "Northwind Payments",
      description: "Card payments for shops in the Baltics.",
      approximateHeadcount: 120,
    },
  });
  await db.aiSettings.create({
    data: {
      enabled: true,
      sealedKey: new Uint8Array(sealSecret("sk-or-test-only-frameworks-0000", secretsKey)),
      keyLast4: "0000",
      keySetById: h.userIds.admin,
      keySetAt: new Date(),
      models: { frameworks: MOCK_MODEL.id },
    },
  });
});
afterAll(() => h.stop());

const SUGGEST = "/api/v1/organisation/frameworks/suggestions";
const suggest = (who: Who = "admin") => h.post(SUGGEST, {}, who);
const frameworks = (res: { body: unknown }) => (res.body as FrameworksResponse).frameworks;
const choose = async (...ids: string[]) =>
  request(h.server())
    .put("/api/v1/organisation/frameworks")
    .set("authorization", await h.auth("admin"))
    .send({ frameworkVersionIds: ids });

describe("AI framework suggestions", () => {
  it("suggests frameworks with reasoning, stored as suggested and ai, audited", async () => {
    const res = await suggest();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      frameworks(res).map((f) => [f.frameworkVersionKey, f.status, f.source, f.reasoning]),
    ).toEqual([
      ["gdpr-2016-679", "suggested", "ai", REASONING],
      ["iso27001-2022", "suggested", "ai", REASONING],
    ]);
    expect(frameworks(res).every((f) => f.confirmedBy === null && f.confirmedAt === null)).toBe(
      true,
    );
    const rows = await audits("organisation.framework_suggested");
    expect(rows.map((r) => [r.objectType, r.actorUserId, r.afterRef])).toEqual([
      [
        "OrganisationFramework",
        h.userIds.admin,
        {
          frameworkVersionKey: "gdpr-2016-679",
          status: "suggested",
          source: "ai",
        },
      ],
      [
        "OrganisationFramework",
        h.userIds.admin,
        {
          frameworkVersionKey: "iso27001-2022",
          status: "suggested",
          source: "ai",
        },
      ],
    ]);
    // The profile goes in the user message, delimited; the catalog in the system prompt.
    const [sent] = requests;
    expect(sent?.schemaName).toBe("framework_suggestion");
    expect(sent?.system).toContain("- iso27001-2022: ");
    expect(sent?.system).not.toContain("Northwind");
    const user = sent?.messages[0]?.content ?? "";
    expect(user.startsWith("<organisation>")).toBe(true);
    for (const part of ["Northwind Payments", "Baltics", "120", "DE, LV"])
      expect(user).toContain(part);
    const interaction = await db.aiInteraction.findFirstOrThrow({
      where: { purpose: "framework_suggestion" },
    });
    expect(interaction).toMatchObject({
      outcome: "pending",
      discardedCount: 0,
    });
  });

  it("still answers with the saved suggestions when the AI bookkeeping fails afterwards", async () => {
    const gateway = h.service(AiGatewayService);
    const discarded = vi
      .spyOn(gateway, "setDiscardedCount")
      .mockRejectedValueOnce(new Error("database blip"));
    const outcome = vi.spyOn(gateway, "setOutcome").mockRejectedValueOnce(new Error("blip"));
    try {
      const res = await suggest();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(frameworks(res).some((f) => f.status === "suggested")).toBe(true);
      expect(discarded).toHaveBeenCalledTimes(1);
      expect(outcome).toHaveBeenCalledTimes(1);
    } finally {
      discarded.mockRestore();
      outcome.mockRestore();
    }
  });

  it("discards a suggested key that is not in the catalog", async () => {
    script = () =>
      JSON.stringify({
        suggestions: [
          { frameworkVersionKey: "made-up-2099", reasoning: "Invented." },
          {
            frameworkVersionKey: "gdpr-2016-679",
            reasoning: "You process personal data.",
          },
        ],
      });
    const res = await suggest();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(frameworks(res).map((f) => [f.frameworkVersionKey, f.reasoning])).toEqual([
      ["gdpr-2016-679", "You process personal data."],
    ]);
    expect(await db.organisationFramework.count()).toBe(1);
    expect(await audits("organisation.framework_suggested")).toHaveLength(1);
    const interaction = await db.aiInteraction.findFirstOrThrow({
      where: { purpose: "framework_suggestion" },
    });
    expect(interaction.discardedCount).toBe(1);
  });

  it("never downgrades a confirmed framework to suggested", async () => {
    expect((await choose(versionIds.iso)).status).toBe(200);
    const res = await suggest();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(frameworks(res).map((f) => [f.frameworkVersionKey, f.status, f.source])).toEqual([
      ["gdpr-2016-679", "suggested", "ai"],
      ["iso27001-2022", "confirmed", "manual"],
    ]);
    const rows = await audits("organisation.framework_suggested");
    expect(
      rows.map((r) => (r.afterRef as { frameworkVersionKey: string }).frameworkVersionKey),
    ).toEqual(["gdpr-2016-679"]);
  });

  it("saving the step confirms chosen suggestions keeping their reasoning and dismisses the rest", async () => {
    const suggested = frameworks(await suggest());
    const gdpr = suggested.find((f) => f.frameworkVersionKey === "gdpr-2016-679");
    const saved = await choose(versionIds.iso);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(frameworks(saved)).toEqual([
      expect.objectContaining({
        frameworkVersionKey: "iso27001-2022",
        status: "confirmed",
        source: "ai",
        reasoning: REASONING,
        confirmedBy: { id: h.userIds.admin, displayName: "Anna Admin" },
      }),
    ]);
    expect(await db.organisationFramework.count()).toBe(1);
    const dismissed = await audits("organisation.framework_suggestion_dismissed");
    expect(dismissed.map((r) => [r.objectType, r.objectId, r.beforeRef, r.afterRef])).toEqual([
      [
        "OrganisationFramework",
        gdpr?.id,
        {
          frameworkVersionKey: "gdpr-2016-679",
          status: "suggested",
          source: "ai",
        },
        null,
      ],
    ]);
    const confirmed = await audits("organisation.framework_confirmed");
    expect(confirmed.map((r) => [r.beforeRef, r.afterRef])).toEqual([
      [
        {
          frameworkVersionKey: "iso27001-2022",
          status: "suggested",
          source: "ai",
        },
        {
          frameworkVersionKey: "iso27001-2022",
          status: "confirmed",
          source: "ai",
        },
      ],
    ]);
  });

  it("refuses suggestions when AI is off with aiUnavailable.disabled", async () => {
    await db.aiSettings.updateMany({ data: { enabled: false } });
    const res = await suggest();
    expect(res.status).toBe(409);
    expect(detailPaths(res)).toEqual(["aiUnavailable.disabled"]);
    expect(requests).toEqual([]);
    expect(await db.organisationFramework.count()).toBe(0);
    expect(await audits("organisation.framework_suggested")).toEqual([]);
  });

  it("is for administrators only", async () => {
    expect((await suggest("rita")).status).toBe(403);
    expect((await suggest("cora")).status).toBe(403);
    expect(requests).toEqual([]);
  });
});
