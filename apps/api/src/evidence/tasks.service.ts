import { Inject, Injectable } from "@nestjs/common";
import type {
  EvidenceDto,
  EvidenceRequestInput,
  MyTaskDto,
  MyTasksResponse,
  TaskUploadQuery,
} from "@isms/contracts";
import { DomainError } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PolicyService, forbidden } from "../authorization/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService, type RawUpload } from "../platform/index.js";
import {
  RiskQueryService,
  TASK_SELECT,
  isoDate,
  riskScope,
  toTask,
  visibleRiskIds,
} from "../risks/index.js";
import { EvidenceService, conflict, notFound } from "./evidence.service.js";

/** Completed tasks stay on the assignee's list this long. */
const DONE_VISIBLE_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
/** Open tasks are never dropped for completed ones: each list has its own cap. */
const MAX_OPEN_TASKS = 500;
const MAX_DONE_TASKS = 100;

/** Evidence requests: a reviewer asks a person for a file; the person uploads it. */
@Injectable()
export class TasksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly risks: RiskQueryService,
    private readonly evidence: EvidenceService,
  ) {}

  async requestEvidence(
    actor: Actor,
    riskId: string,
    input: EvidenceRequestInput,
    ctx: AuditContext,
  ): Promise<MyTaskDto> {
    const risk = await this.risks.getVisible(actor, riskId);
    if (!this.policy.can(actor, "risks.review", riskScope(risk))) throw forbidden();
    const assignee = await this.prisma.user.findFirst({
      where: { id: input.assigneeId },
      select: { id: true },
    });
    if (!assignee)
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        { path: "assigneeId", message: "Unknown person" },
      ]);
    const id = await this.prisma.$transaction(async (tx) => {
      // FOR SHARE: a control cannot be removed while a request for it is being made.
      await tx.$executeRaw`SELECT 1 FROM "Risk" WHERE id = ${riskId}::uuid FOR SHARE`;
      const control = await tx.riskControl.findFirst({
        where: { riskId, controlId: input.controlId, status: "accepted" },
        select: { control: { select: { code: true } } },
      });
      if (!control)
        throw conflict(
          "controlNotAccepted",
          "Evidence can only be requested for accepted controls",
        );
      const task = await tx.task.create({
        data: {
          kind: "evidence_request",
          title: input.title,
          description: input.description,
          assigneeId: input.assigneeId,
          requestedById: actor.userId,
          dueDate: input.dueDate === null ? null : new Date(input.dueDate),
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
            kind: "evidence_request",
            riskId,
            controlCode: control.control.code,
            assigneeId: input.assigneeId,
            dueDate: input.dueDate,
            // Free text by length only; the text stays in the row.
            title: { length: input.title.length },
            description: { length: input.description.length },
          },
        },
        ctx,
        tx,
      );
      return task.id;
    });
    const row = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      select: TASK_SELECT,
    });
    return toTask(
      row,
      isoDate(new Date()),
      await visibleRiskIds(this.prisma, this.policy, actor, [riskId]),
    );
  }

  /** The caller's own tasks: the risk's reference, and its id only when they may see it. */
  async myTasks(actor: Actor): Promise<MyTasksResponse> {
    const now = new Date();
    const since = new Date(now.getTime() - DONE_VISIBLE_DAYS * DAY_MS);
    const [open, done] = await Promise.all([
      this.prisma.task.findMany({
        where: { assigneeId: actor.userId, status: "open" },
        select: TASK_SELECT,
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
        take: MAX_OPEN_TASKS,
      }),
      this.prisma.task.findMany({
        where: {
          assigneeId: actor.userId,
          status: "done",
          completedAt: { gte: since },
        },
        select: TASK_SELECT,
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        take: MAX_DONE_TASKS,
      }),
    ]);
    const rows = [...open, ...done];
    const today = isoDate(now);
    const visible = await visibleRiskIds(
      this.prisma,
      this.policy,
      actor,
      rows.map((t) => t.riskId),
    );
    return { items: rows.map((t) => toTask(t, today, visible)) };
  }

  /** The assignee uploads the requested file, which completes the task. */
  async uploadForTask(
    actor: Actor,
    taskId: string,
    query: TaskUploadQuery,
    file: RawUpload,
    ctx: AuditContext,
  ): Promise<EvidenceDto> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, assigneeId: actor.userId },
      select: { kind: true, riskId: true, controlId: true },
    });
    if (!task) throw notFound();
    // Treatment actions complete through TreatmentService.complete, which records the note.
    if (task.kind !== "evidence_request")
      throw conflict("invalidTransition", "Only evidence requests are completed by upload");
    const { riskId, controlId } = task;
    if (controlId === null) throw conflict("controlNotAccepted", "The task names no control");
    return this.evidence.store(
      actor,
      { riskId, taskId, file, ...query, controlIds: [controlId] },
      {
        check: async (db) => {
          // In the transaction this locks the task, so two uploads cannot both complete it.
          const [row] = await db.$queryRaw<{ status: string }[]>`
            SELECT status::text FROM "Task" WHERE id = ${taskId}::uuid FOR UPDATE`;
          if (row?.status !== "open") throw conflict("taskClosed", "The task is already closed");
        },
        after: async (tx, evidenceId) => {
          await tx.task.update({
            where: { id: taskId },
            data: { status: "done", completedAt: new Date(), completedById: actor.userId },
            select: { id: true },
          });
          await this.audit.record(
            {
              action: "task.completed",
              objectType: "Task",
              objectId: taskId,
              before: { status: "open" },
              after: { status: "done", evidenceId },
            },
            ctx,
            tx,
          );
        },
      },
      ctx,
    );
  }
}
