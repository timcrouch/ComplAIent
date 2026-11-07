import { Inject, Injectable } from "@nestjs/common";
import {
  type AddTreatmentActionInput,
  type CancelTaskInput,
  type CompleteTaskInput,
  type ConflictReason,
  type MyTaskDto,
  type TreatmentActionDto,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { DomainError, type RiskState, type Treatment, mayPlanActions } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import { isoDate } from "./task-due.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { riskScope } from "./mappers.js";
import { RiskQueryService } from "./risk-query.service.js";
import { TASK_SELECT, toTask, visibleRiskIds } from "./task-dto.js";
import { TREATMENT_ACTION_SELECT, toTreatmentAction } from "./treatment-plan.js";

type Tx = Prisma.TransactionClient;

const conflict = (reason: ConflictReason, message: string) =>
  new DomainError("CONFLICT", message, [conflictDetail(reason)]);
const notFound = () => new DomainError("NOT_FOUND", "Not found");

/** The task row complete and cancel start from, with where its risk sits. */
type TaskRef = {
  id: string;
  kind: "evidence_request" | "treatment_action" | "periodic_review";
  assigneeId: string;
  riskId: string;
};

/**
 * Treatment actions: a reviewer plans them on a risk, the assignee completes them (without
 * seeing the risk), a reviewer may cancel them.
 */
@Injectable()
export class TreatmentService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly risks: RiskQueryService,
  ) {}

  async addAction(
    actor: Actor,
    riskId: string,
    input: AddTreatmentActionInput,
    ctx: AuditContext,
  ): Promise<TreatmentActionDto> {
    const risk = await this.risks.getVisible(actor, riskId);
    if (!this.policy.can(actor, "risks.review", riskScope(risk))) throw forbidden();
    this.requirePlannable(risk);
    if (input.dueDate < isoDate(new Date()))
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "dueDate", message: "The due date cannot be in the past" },
      ]);
    const assignee = await this.prisma.user.findFirst({
      where: { id: input.assigneeId },
      select: { id: true },
    });
    if (!assignee)
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "assigneeId", message: "Unknown person" },
      ]);
    const id = await this.prisma.$transaction(async (tx) => {
      // FOR SHARE: the risk cannot be closed, nor a control removed, while an action is added.
      await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${riskId}::uuid FOR SHARE`;
      this.requirePlannable(
        await tx.risk.findUniqueOrThrow({
          where: { id: riskId },
          select: { state: true, treatment: true },
        }),
      );
      let controlCode: string | null = null;
      if (input.controlId !== null) {
        const accepted = await tx.riskControl.findFirst({
          where: { riskId, controlId: input.controlId, status: "accepted" },
          select: { control: { select: { code: true } } },
        });
        if (!accepted)
          throw conflict("controlNotAccepted", "The control is not accepted on this risk");
        controlCode = accepted.control.code;
      }
      const task = await tx.task.create({
        data: {
          kind: "treatment_action",
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          requestedById: actor.userId,
          dueDate: new Date(input.dueDate),
          riskId,
          controlId: input.controlId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "task.created",
          objectType: "Task",
          objectId: task.id,
          after: {
            kind: "treatment_action",
            riskId,
            controlCode,
            assigneeId: input.assigneeId,
            dueDate: input.dueDate,
            title: { length: input.title.length },
            description: { length: input.description.length },
          },
        },
        ctx,
        tx,
      );
      return task.id;
    });
    return this.action(id);
  }

  /** The assignee or a reviewer completes a treatment action. */
  async complete(
    actor: Actor,
    taskId: string,
    input: CompleteTaskInput,
    ctx: AuditContext,
  ): Promise<MyTaskDto> {
    const task = await this.findTask(taskId);
    const reviewer = await this.mayReview(actor, task.riskId);
    if (task.assigneeId !== actor.userId && !reviewer) throw notFound();
    // Evidence requests complete by upload; review tasks by confirming the review or approval.
    if (task.kind !== "treatment_action")
      throw conflict("invalidTransition", "Only treatment actions are completed here");
    await this.prisma.$transaction(async (tx) => {
      await this.requireOpen(tx, taskId);
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: "done",
          completedAt: new Date(),
          completedById: actor.userId,
          completionNote: input.note,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "task.completed",
          objectType: "Task",
          objectId: taskId,
          before: { status: "open" },
          after: {
            status: "done",
            kind: task.kind,
            riskId: task.riskId,
            note: { length: input.note.length },
          },
        },
        ctx,
        tx,
      );
    });
    const row = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: TASK_SELECT,
    });
    return toTask(
      row,
      isoDate(new Date()),
      await visibleRiskIds(this.prisma, this.policy, actor, [row.riskId]),
    );
  }

  /** A reviewer cancels an open treatment action. */
  async cancel(
    actor: Actor,
    taskId: string,
    input: CancelTaskInput,
    ctx: AuditContext,
  ): Promise<TreatmentActionDto> {
    const task = await this.findTask(taskId);
    if (!(await this.mayReview(actor, task.riskId))) {
      // The assignee knows of the task, so they are refused; anyone else cannot see it.
      if (task.assigneeId === actor.userId) throw forbidden();
      throw notFound();
    }
    if (task.kind !== "treatment_action")
      throw conflict("invalidTransition", "Only treatment actions can be cancelled");
    await this.prisma.$transaction(async (tx) => {
      await this.requireOpen(tx, taskId);
      await tx.task.update({
        where: { id: taskId },
        data: { status: "cancelled", cancelledReason: input.reason, cancelledById: actor.userId },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "task.cancelled",
          objectType: "Task",
          objectId: taskId,
          before: { status: "open" },
          after: {
            status: "cancelled",
            riskId: task.riskId,
            reason: { length: input.reason.length },
          },
        },
        ctx,
        tx,
      );
    });
    return this.action(taskId);
  }

  private requirePlannable(risk: { state: RiskState; treatment: Treatment | null }): void {
    if (mayPlanActions(risk.state, risk.treatment)) return;
    if (risk.state === "closed") throw conflict("riskClosed", "The risk is closed");
    throw conflict("treatmentIsAccept", "A risk that is accepted needs no treatment actions");
  }

  private async findTask(id: string): Promise<TaskRef> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, kind: true, assigneeId: true, riskId: true },
    });
    if (!task) throw notFound();
    return task;
  }

  /** The actor holds risks.review at the risk's scope and may see the risk. */
  private async mayReview(actor: Actor, riskId: string): Promise<boolean> {
    try {
      const risk = await this.risks.getVisible(actor, riskId);
      return this.policy.can(actor, "risks.review", riskScope(risk));
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") return false;
      throw error;
    }
  }

  /** Locks the task, so two completions or cancellations cannot both win. */
  private async requireOpen(tx: Tx, id: string): Promise<void> {
    const [row] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM "Task" WHERE id = ${id}::uuid FOR UPDATE`;
    if (row?.status !== "open") throw conflict("taskClosed", "The task is already closed");
  }

  private async action(id: string): Promise<TreatmentActionDto> {
    const row = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      select: TREATMENT_ACTION_SELECT,
    });
    return toTreatmentAction(row, isoDate(new Date()));
  }
}
