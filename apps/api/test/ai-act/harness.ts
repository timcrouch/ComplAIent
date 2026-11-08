import { randomBytes } from "node:crypto";
import { MOCK_MODEL, sealSecret } from "@isms/ai";
import type { AiSystemDetailDto } from "@isms/contracts";
import request from "supertest";
import { expect } from "vitest";
import { AiModule } from "../../src/ai/index.js";
import { AiActModule } from "../../src/ai-act/index.js";
import { type Who, db, risksHarness } from "../risks/harness.js";

export { audits, db, detailPaths, type ErrorBody, type Who } from "../risks/harness.js";

export const SYSTEMS = "/api/v1/ai-act/systems";

type Role =
  "administrator" | "ciso" | "risk_owner" | "risk_approver" | "contributor" | "viewer" | "auditor";

/**
 * The risks harness (users, sites A and B) with the AI Act module, and the mock AI provider
 * under a known secrets key. The module starts off after every reset.
 */
export function aiActHarness() {
  const secretsKey = randomBytes(32);
  const h = risksHarness({
    imports: [AiActModule, AiModule.forRoot({ secretsKey, provider: "mock" })],
  });

  const profile = (overrides: Record<string, unknown> = {}) => ({
    name: "Credit scoring engine",
    description: "Scores consumer loan applications from bureau data.",
    intendedPurpose: "Decide which loan applications go to manual review.",
    role: "deployer",
    supplier: "Vendor GmbH",
    model: "vendor scoring engine v4",
    usesGeneralPurposeModel: false,
    status: "in_use",
    ownerId: h.userIds.oscar,
    departmentId: null,
    ...overrides,
  });

  return {
    ...h,
    profile,
    async put(path: string, body: unknown, who: Who) {
      return request(h.server())
        .put(path)
        .set("authorization", await h.auth(who))
        .send(body as object);
    },
    async enableModule(): Promise<void> {
      await db.organisationModule.create({
        data: { key: "eu_ai_act", enabledAt: new Date(), enabledById: h.userIds.admin },
      });
    },
    async enableAi(enabled = true): Promise<void> {
      await db.aiSettings.create({
        data: {
          enabled,
          sealedKey: new Uint8Array(sealSecret("sk-or-test-only-aiact-0000", secretsKey)),
          keyLast4: "0000",
          keySetById: h.userIds.admin,
          keySetAt: new Date(),
          models: { controls: MOCK_MODEL.id },
        },
      });
    },
    /** One more role assignment for a harness user (roles are read per request). */
    async grant(who: Who, role: Role, scope: "org" | "siteA" | "siteB" = "org"): Promise<void> {
      await db.roleAssignment.create({
        data: {
          userId: h.userIds[who],
          role,
          grantedById: h.userIds.admin,
          ...(scope === "org"
            ? { scopeType: "ORGANISATION" }
            : { scopeType: "SITE", siteId: h.sites[scope] }),
        },
      });
    },
    /** Adds a system as Cora (ciso) and returns it. */
    async createSystem(overrides: Record<string, unknown> = {}): Promise<AiSystemDetailDto> {
      const res = await h.post(SYSTEMS, profile(overrides), "cora");
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body as AiSystemDetailDto;
    },
    /** A risk straight in the database, at a site and in a state. */
    async insertRisk(
      title: string,
      opts: { site?: "siteA" | "siteB"; state?: "proposed" | "approved" } = {},
    ): Promise<string> {
      const risk = await db.risk.create({
        data: {
          title,
          scenario: "S",
          threat: "T",
          consequence: "C",
          toConfirm: [],
          reporterId: h.userIds.rita,
          aiAssisted: false,
          state: opts.state ?? "proposed",
          ...(opts.site ? { siteId: h.sites[opts.site] } : {}),
        },
      });
      return risk.id;
    },
  };
}

/** Answers for a high-risk creditworthiness system, overridable. */
export const creditAnswers = (overrides: Record<string, unknown> = {}) => ({
  isAiSystem: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIAreas: ["creditworthiness"],
  profilesPeople: true,
  derogation: "none",
  transparency: [],
  ...overrides,
});

/** Answers with nothing that applies: minimal risk. */
export const minimalAnswers = () =>
  creditAnswers({ annexIIIAreas: [], profilesPeople: null, derogation: null });
