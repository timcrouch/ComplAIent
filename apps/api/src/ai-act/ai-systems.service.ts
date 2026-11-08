import { Inject, Injectable } from "@nestjs/common";
import type {
  AiSystemDetailDto,
  AiSystemInput,
  AiSystemListResponse,
  AiSystemUpdateInput,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { applicableObligations } from "@isms/domain";
import { type AuditContext, type AuditJson, AuditService } from "../audit/index.js";
import type { Actor } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { AiSystemReader, lockSystem, notFound } from "./ai-system-reader.js";
import { SUMMARY_SELECT, parseClassification, toSummary } from "./ai-system-view.js";
import { conflict, invalid, isUniqueViolation } from "./errors.js";
import { isEmptyPlan, reconcileObligations } from "./reconcile.js";

type Tx = Prisma.TransactionClient;
type Field = keyof AiSystemInput;

/** Free text, which the audit trail records by length only (as for risks). */
const TEXT_FIELDS: ReadonlySet<Field> = new Set(["description", "intendedPurpose"]);

const FIELDS: readonly Field[] = [
  "name",
  "description",
  "intendedPurpose",
  "role",
  "supplier",
  "model",
  "usesGeneralPurposeModel",
  "status",
  "ownerId",
  "departmentId",
];

const PROFILE_SELECT = {
  name: true,
  description: true,
  intendedPurpose: true,
  role: true,
  supplier: true,
  model: true,
  usesGeneralPurposeModel: true,
  status: true,
  ownerId: true,
  departmentId: true,
  classification: true,
} as const satisfies Prisma.AiSystemSelect;

/** One field as the audit trail records it. */
const auditValue = (field: Field, value: AuditJson): AuditJson =>
  TEXT_FIELDS.has(field)
    ? { changed: true, length: typeof value === "string" ? value.length : 0 }
    : value;

/** `lower(btrim(name))`, exactly as the database's check constraint derives it. */
async function nameKey(tx: Tx, name: string): Promise<string> {
  const rows = await tx.$queryRaw<{ key: string }[]>`SELECT lower(btrim(${name})) AS key`;
  return rows[0]?.key ?? "";
}

/** 400 at `ownerId` or `departmentId` when they name nothing stored. */
async function checkReferences(
  tx: Tx,
  input: Pick<AiSystemUpdateInput, "ownerId" | "departmentId">,
): Promise<void> {
  if (input.ownerId !== undefined && (await tx.user.count({ where: { id: input.ownerId } })) === 0)
    throw invalid("ownerId", "Not a user");
  if (
    input.departmentId != null &&
    (await tx.department.count({ where: { id: input.departmentId } })) === 0
  )
    throw invalid("departmentId", "Not a department");
}

/**
 * The AI system register (#16 §3): list, add and change. There is no delete: retiring is a
 * status change. Every change is audited (`ai_system.created`, `ai_system.updated`).
 */
@Injectable()
export class AiSystemsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reader: AiSystemReader,
  ) {}

  async list(): Promise<AiSystemListResponse> {
    const rows = await this.prisma.aiSystem.findMany({
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      select: SUMMARY_SELECT,
    });
    return { systems: rows.map(toSummary) };
  }

  get(actor: Actor, id: string): Promise<AiSystemDetailDto> {
    return this.reader.detail(actor, id);
  }

  async create(actor: Actor, input: AiSystemInput, ctx: AuditContext): Promise<AiSystemDetailDto> {
    const id = await this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        await checkReferences(tx, input);
        const created = await tx.aiSystem.create({
          data: { ...input, nameKey: await nameKey(tx, input.name), createdById: actor.userId },
          select: { id: true },
        });
        const after: Record<string, AuditJson> = {};
        for (const field of FIELDS) after[field] = auditValue(field, input[field]);
        await this.audit.record(
          { action: "ai_system.created", objectType: "AiSystem", objectId: created.id, after },
          ctx,
          tx,
        );
        return created.id;
      }),
    );
    return this.reader.detail(actor, id);
  }

  /**
   * Changes the given fields; unchanged values are not written or audited. A role change
   * re-reconciles the obligations when the system is classified, in the same transaction.
   */
  async update(
    actor: Actor,
    id: string,
    input: AiSystemUpdateInput,
    ctx: AuditContext,
  ): Promise<AiSystemDetailDto> {
    await this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        await lockSystem(tx, id);
        const stored = await tx.aiSystem.findUnique({ where: { id }, select: PROFILE_SELECT });
        if (!stored) throw notFound();
        const changed = FIELDS.filter((f) => input[f] !== undefined && input[f] !== stored[f]);
        if (changed.length === 0) return;
        await checkReferences(tx, {
          ...(changed.includes("ownerId") ? { ownerId: input.ownerId } : {}),
          ...(changed.includes("departmentId") ? { departmentId: input.departmentId } : {}),
        });
        const data: Prisma.AiSystemUncheckedUpdateInput = {};
        const before: Record<string, AuditJson> = {};
        const after: Record<string, AuditJson> = { changedFields: changed };
        for (const field of changed) {
          Object.assign(data, { [field]: input[field] });
          if (!TEXT_FIELDS.has(field)) before[field] = stored[field];
          after[field] = auditValue(field, input[field] ?? null);
        }
        if (input.name !== undefined && changed.includes("name"))
          data.nameKey = await nameKey(tx, input.name);
        await tx.aiSystem.update({ where: { id }, data, select: { id: true } });

        if (
          input.role !== undefined &&
          changed.includes("role") &&
          stored.classification !== null
        ) {
          const record = parseClassification(stored.classification);
          const plan = await reconcileObligations(
            tx,
            id,
            applicableObligations(record.result, input.role, record.answers),
          );
          if (!isEmptyPlan(plan)) after["obligations"] = plan;
        }
        await this.audit.record(
          { action: "ai_system.updated", objectType: "AiSystem", objectId: id, before, after },
          ctx,
          tx,
        );
      }),
    );
    return this.reader.detail(actor, id);
  }

  /** Maps the name key's unique violation to 409 duplicateAiSystemName. */
  private async unique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict("duplicateAiSystemName", "An AI system with this name exists");
      throw err;
    }
  }
}
