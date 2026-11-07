import { Inject, Injectable } from "@nestjs/common";
import { ControlTestStepsOutput, buildControlTestStepsPrompt } from "@isms/ai";
import {
  type ControlOperationDto,
  type ControlTestDto,
  type ControlTestStepsResponse,
  type RecordControlTestInput,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import {
  type Clock,
  DEFAULT_REVIEW_INTERVAL_MONTHS,
  DomainError,
  formatRiskReference,
  isReviewDue,
  isoDateUtc,
  reviewDueDate,
} from "@isms/domain";
import { AiGatewayService } from "../ai/index.js";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService } from "../authorization/index.js";
import { CLOCK, type Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { dateOnly } from "./review-tasks.js";
import { riskVisibilityWhere } from "./risk-visibility.js";

const HISTORY_LIMIT = 50;
const OPTION_LIMIT = 200;
const STEPS_MAX_TOKENS = 1000;
const STEPS_TIMEOUT_MS = 60_000;

/** A test with only the evidence on risks the reader may see (none without risks.read). */
const testSelect = (visibleEvidence: Prisma.ControlTestEvidenceWhereInput) =>
  ({
    id: true,
    testedOn: true,
    result: true,
    method: true,
    notes: true,
    testedBy: { select: { id: true, displayName: true } },
    evidence: {
      where: visibleEvidence,
      select: { evidence: { select: { id: true, fileName: true } } },
      orderBy: { evidenceId: "asc" },
    },
    _count: { select: { evidence: true } },
  }) as const satisfies Prisma.ControlTestSelect;
type TestRow = Prisma.ControlTestGetPayload<{ select: ReturnType<typeof testSelect> }>;

const toTest = (t: TestRow): ControlTestDto => ({
  id: t.id,
  testedOn: isoDateUtc(t.testedOn),
  result: t.result,
  method: t.method,
  notes: t.notes,
  testedBy: { id: t.testedBy.id, displayName: t.testedBy.displayName },
  evidence: t.evidence.map((e) => ({ id: e.evidence.id, fileName: e.evidence.fileName })),
  hiddenEvidenceCount: t._count.evidence - t.evidence.length,
});

const notFound = () => new DomainError("NOT_FOUND", "Not found");

/**
 * Controls in operation: where a control is used, the evidence behind it and its test history.
 * Lives with the risks (it reads risk visibility); the library list only needs plain flags.
 */
@Injectable()
export class ControlOperationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly ai: AiGatewayService,
  ) {}

  private async controlId(code: string): Promise<string> {
    const control = await this.prisma.control.findUnique({ where: { code }, select: { id: true } });
    if (!control) throw notFound();
    return control.id;
  }

  private async intervalMonths(): Promise<number> {
    const org = await this.prisma.organisation.findFirst({
      select: { reviewIntervalMonths: true },
    });
    return org?.reviewIntervalMonths ?? DEFAULT_REVIEW_INTERVAL_MONTHS;
  }

  /** Evidence on risks the actor may see, linked to the control; nothing without risks.read. */
  private evidenceWhere(actor: Actor, controlId: string): Prisma.EvidenceWhereInput {
    return { controls: { some: { controlId } }, risk: riskVisibilityWhere(actor) };
  }

  /** The test evidence links the actor may see: on visible risks, and none without risks.read. */
  private visibleTestEvidence(actor: Actor): Prisma.ControlTestEvidenceWhereInput {
    return this.policy.canAtAnyScope(actor, "risks.read")
      ? { evidence: { risk: riskVisibilityWhere(actor) } }
      : { evidenceId: { in: [] } };
  }

  async operation(actor: Actor, code: string): Promise<ControlOperationDto> {
    const controlId = await this.controlId(code);
    const readsRisks = this.policy.canAtAnyScope(actor, "risks.read");
    // Organisation-level only (#24), matching the route guard.
    const canRecordTest = this.policy.can(actor, "controls.test");
    const [rows, tests, months, evidenceCount, options, stepsReady] = await Promise.all([
      readsRisks
        ? this.prisma.riskControl.findMany({
            where: { controlId, status: "accepted", risk: riskVisibilityWhere(actor) },
            orderBy: { risk: { reference: "asc" } },
            select: { risk: { select: { id: true, reference: true, title: true, state: true } } },
          })
        : [],
      this.prisma.controlTest.findMany({
        where: { controlId },
        orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: HISTORY_LIMIT,
        select: testSelect(this.visibleTestEvidence(actor)),
      }),
      this.intervalMonths(),
      readsRisks ? this.prisma.evidence.count({ where: this.evidenceWhere(actor, controlId) }) : 0,
      readsRisks
        ? this.prisma.evidence.findMany({
            where: this.evidenceWhere(actor, controlId),
            orderBy: [{ collectedAt: "desc" }, { id: "desc" }],
            take: OPTION_LIMIT,
            select: { id: true, fileName: true, risk: { select: { reference: true } } },
          })
        : [],
      canRecordTest
        ? this.ai.readiness("control_test_steps").then((r) => r.ready)
        : Promise.resolve(false),
    ]);
    const latest = tests[0] ?? null;
    const today = isoDateUtc(this.clock.now());
    return {
      code,
      risks: rows.map(({ risk }) => ({
        id: risk.id,
        reference: formatRiskReference(risk.reference),
        title: risk.title,
        state: risk.state,
      })),
      evidenceCount,
      tests: tests.map(toTest),
      latest: latest ? toTest(latest) : null,
      testDue: latest === null || isReviewDue(reviewDueDate(latest.testedOn, months), today),
      canRecordTest,
      canSuggestSteps: stepsReady,
      evidenceOptions: options.map((e) => ({
        id: e.id,
        fileName: e.fileName,
        riskReference: formatRiskReference(e.risk.reference),
      })),
    };
  }

  /**
   * AI-suggested steps for testing a control, from the library text only (no risks, evidence or
   * tests are sent). Nothing is stored but the AiInteraction. 409 aiUnavailable.<reason>.
   */
  async testSteps(actor: Actor, code: string): Promise<ControlTestStepsResponse> {
    const control = await this.prisma.control.findUnique({
      where: { code },
      select: { id: true, code: true, title: true, description: true, guidance: true },
    });
    if (!control) throw notFound();
    const aiUnavailable = (reason: string) =>
      new DomainError("CONFLICT", "The AI assistant is not available", [
        conflictDetail("aiUnavailable", reason, "aiUnavailable"),
      ]);
    const readiness = await this.ai.readiness("control_test_steps");
    if (!readiness.ready) throw aiUnavailable(readiness.reason);
    const result = await this.ai.run("control_test_steps", {
      ...buildControlTestStepsPrompt(control),
      schema: ControlTestStepsOutput,
      schemaName: "control_test_steps",
      maxTokens: STEPS_MAX_TOKENS,
      timeoutMs: STEPS_TIMEOUT_MS,
      actorUserId: actor.userId,
      object: { type: "Control", id: control.id },
    });
    if (!result.ok) throw aiUnavailable(result.reason);
    return { steps: result.value.steps, interactionId: result.interactionId };
  }

  async recordTest(
    actor: Actor,
    code: string,
    input: RecordControlTestInput,
    ctx: AuditContext,
  ): Promise<ControlTestDto> {
    const controlId = await this.controlId(code);
    const invalid = (path: string, message: string) =>
      new DomainError("VALIDATION_FAILED", "Request validation failed", [{ path, message }]);
    if (input.testedOn > isoDateUtc(this.clock.now()))
      throw invalid("testedOn", "The test date cannot be in the future");

    const ids = [...new Set(input.evidenceIds)];
    const usable = new Set(
      ids.length === 0 || !this.policy.canAtAnyScope(actor, "risks.read")
        ? []
        : (
            await this.prisma.evidence.findMany({
              where: { AND: [{ id: { in: ids } }, this.evidenceWhere(actor, controlId)] },
              select: { id: true },
            })
          ).map((e) => e.id),
    );
    const bad = input.evidenceIds.findIndex((id) => !usable.has(id));
    if (bad !== -1)
      throw invalid(`evidenceIds.${String(bad)}`, "This evidence is not linked to the control");

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.controlTest.create({
        data: {
          controlId,
          testedOn: dateOnly(input.testedOn),
          result: input.result,
          method: input.method,
          notes: input.notes,
          testedById: actor.userId,
          evidence: { create: ids.map((evidenceId) => ({ evidenceId })) },
        },
        select: testSelect(this.visibleTestEvidence(actor)),
      });
      await this.audit.record(
        {
          action: "control.tested",
          objectType: "ControlTest",
          objectId: row.id,
          after: {
            controlCode: code,
            testedOn: input.testedOn,
            result: input.result,
            evidenceCount: ids.length,
            method: { length: input.method.length },
            notes: { length: input.notes.length },
          },
        },
        ctx,
        tx,
      );
      return toTest(row);
    });
  }
}
