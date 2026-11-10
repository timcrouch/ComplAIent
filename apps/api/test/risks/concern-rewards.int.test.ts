import type {
  ConcernEvaluationDto,
  ConcernEvaluationQueueDto,
  SecurityContributionDto,
} from "@isms/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, risksHarness } from "./harness.js";

describe("concern rewards API", () => {
  const h = risksHarness();
  beforeAll(() => h.start());
  beforeEach(async () => {
    await h.reset();
    await db.organisation.create({
      data: { name: "Test", description: "", concernRewardsEnabled: true },
    });
  });
  afterAll(() => h.stop());

  async function provisional() {
    const risk = await db.risk.create({
      data: {
        title: "Unlocked admin laptop",
        scenario: "An unknown person used an unlocked admin laptop.",
        threat: "Unauthorized access",
        consequence: "Privileged data could be exposed.",
        reporterId: h.userIds.april,
        aiAssisted: false,
      },
    });
    const group = await db.concernDuplicateGroup.create({ data: {} });
    const evaluation = await db.concernEvaluation.create({
      data: {
        riskId: risk.id,
        reporterId: h.userIds.april,
        status: "provisional",
        source: "ai",
        legitimacy: "confirmed",
        severity: "critical",
        confidence: 0.94,
        feedback: "Thank you for reporting this high-impact concern.",
        rationale: "Privileged unauthorized access is credible and urgent.",
        uncertainty: "The CISO should confirm who accessed the device.",
        duplicateGroupId: group.id,
        duplicatePosition: 1,
        legitimacyPoints: 100,
        severityPoints: 100,
        positionPoints: 50,
        totalPoints: 250,
        requiresReview: true,
      },
    });
    await db.concernRewardEntry.create({
      data: {
        evaluationId: evaluation.id,
        userId: h.userIds.april,
        kind: "award",
        points: 250,
        legitimacyPoints: 100,
        severityPoints: 100,
        positionPoints: 50,
      },
    });
    await db.concernBadgeEvent.createMany({
      data: ["first_signal", "high_impact"].map((badgeKey) => ({
        userId: h.userIds.april,
        badgeKey: badgeKey as "first_signal" | "high_impact",
        kind: "awarded" as const,
        evaluationId: evaluation.id,
      })),
    });
    return { risk, evaluation };
  }

  it("shows a private contribution profile only for the signed-in reporter", async () => {
    const { risk } = await provisional();
    const mine = await h.get("/api/v1/me/security-contribution", "april");
    expect(mine.status).toBe(200);
    expect(mine.body as SecurityContributionDto).toMatchObject({
      points: { total: 250, provisional: 250 },
      rank: { key: "defender" },
      badges: [{ key: "first_signal" }, { key: "high_impact" }],
      recent: [{ riskId: risk.id, status: "provisional", points: { total: 250 } }],
    });
    expect((await h.get("/api/v1/me", "april")).body).toMatchObject({
      concernRank: "defender",
    });
    const other = await h.get("/api/v1/me/security-contribution", "rita");
    expect(other.status).toBe(200);
    expect(other.body as SecurityContributionDto).toMatchObject({
      points: { total: 0, provisional: 0 },
      badges: [],
      recent: [],
    });
    expect((await h.get("/api/v1/me", "rita")).body).toMatchObject({ concernRank: null });
  });

  it("restricts the judgment queue to the CISO and includes escalated AI context", async () => {
    const { evaluation } = await provisional();
    const queue = await h.get("/api/v1/concern-evaluations/queue", "cora");
    expect(queue.status).toBe(200);
    expect((queue.body as ConcernEvaluationQueueDto).items[0]).toMatchObject({
      evaluation: { id: evaluation.id, severity: "critical" },
      rationale: "Privileged unauthorized access is credible and urgent.",
    });
    expect((await h.get("/api/v1/concern-evaluations/queue", "admin")).status).toBe(403);
    expect((await h.get("/api/v1/concern-evaluations/queue", "april")).status).toBe(403);
  });

  it("counts repeatable badge occurrences and revokes only the corrected concern", async () => {
    const first = await provisional();
    await provisional();
    expect((await h.get("/api/v1/me/security-contribution", "april")).body).toMatchObject({
      badges: [
        { key: "first_signal", repeatable: true, count: 2 },
        { key: "high_impact", repeatable: true, count: 2 },
      ],
    });

    const judged = await h.post(
      `/api/v1/risks/${first.risk.id}/concern-evaluation`,
      {
        legitimacy: "not_confirmed",
        severity: "minor",
        duplicateRiskId: null,
        feedback: "Thank you for raising this. Review did not confirm unauthorized access.",
        rationale: "Access logs showed authorized use.",
      },
      "cora",
    );
    expect(judged.status).toBe(200);
    expect((await h.get("/api/v1/me/security-contribution", "april")).body).toMatchObject({
      badges: [
        { key: "first_signal", count: 1 },
        { key: "high_impact", count: 1 },
      ],
    });
  });

  it("lets the CISO override points and badges through append-only adjustment history", async () => {
    const { risk, evaluation } = await provisional();
    const body = {
      legitimacy: "not_confirmed",
      severity: "minor",
      duplicateRiskId: null,
      feedback: "Thank you for raising this. Review did not confirm unauthorized access.",
      rationale: "Access logs showed the device was used by its assigned administrator.",
    };
    expect(
      (await h.post(`/api/v1/risks/${risk.id}/concern-evaluation`, body, "admin")).status,
    ).toBe(403);
    expect(
      (await h.post(`/api/v1/risks/${risk.id}/concern-evaluation`, body, "april")).status,
    ).toBe(403);
    const judged = await h.post(`/api/v1/risks/${risk.id}/concern-evaluation`, body, "cora");
    expect(judged.status, JSON.stringify(judged.body)).toBe(200);
    expect(judged.body as ConcernEvaluationDto).toMatchObject({
      status: "final",
      source: "ciso",
      legitimacy: "not_confirmed",
      points: { total: 0 },
    });
    expect(
      (await db.concernEvaluation.findUniqueOrThrow({ where: { id: evaluation.id } })).status,
    ).toBe("overridden");
    expect(
      (await db.concernRewardEntry.findMany({ orderBy: { createdAt: "asc" } })).map(
        (entry) => entry.points,
      ),
    ).toEqual([250, -250]);
    expect(
      (await db.concernBadgeEvent.findMany({ orderBy: { createdAt: "asc" } })).map((event) => [
        event.badgeKey,
        event.kind,
      ]),
    ).toEqual([
      ["first_signal", "awarded"],
      ["high_impact", "awarded"],
      ["first_signal", "revoked"],
      ["high_impact", "revoked"],
    ]);
    expect((await h.get("/api/v1/me/security-contribution", "april")).body).toMatchObject({
      points: { total: 0, provisional: 0 },
      badges: [],
      recent: [{ status: "final", legitimacy: "not_confirmed" }],
    });
    expect((await h.get("/api/v1/me", "april")).body).toMatchObject({ concernRank: null });
  });
});
