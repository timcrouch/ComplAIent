import { Inject, Injectable } from "@nestjs/common";
import type { RiskScaleDto, RiskScaleInput } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { DEFAULT_APPETITE_THRESHOLD } from "@isms/domain";
import { DEFAULT_RISK_SCALE } from "./default-risk-scale.js";
import { withSetupLock } from "./setup-lock.js";

const SCALE_SELECT = {
  id: true,
  version: true,
  appetiteThreshold: true,
  levels: {
    orderBy: [{ axis: "asc" }, { value: "asc" }],
    select: { axis: true, value: true, label: true, description: true },
  },
} as const satisfies Prisma.RiskScaleSelect;

type StoredScale = Prisma.RiskScaleGetPayload<{ select: typeof SCALE_SELECT }>;

function toDto(scale: StoredScale): RiskScaleDto {
  const axis = (a: "likelihood" | "impact") =>
    scale.levels
      .filter((l) => l.axis === a)
      .map((l) => ({ value: l.value, label: l.label, description: l.description }));
  return {
    version: scale.version,
    appetiteThreshold: scale.appetiteThreshold,
    likelihood: axis("likelihood"),
    impact: axis("impact"),
  };
}

const latest = (db: Prisma.TransactionClient) =>
  db.riskScale.findFirst({ orderBy: { version: "desc" }, select: SCALE_SELECT });

/**
 * The organisation's risk scale. Versions are append-only (the app role cannot update or
 * delete them): changing the appetite adds a version with the default levels.
 */
@Injectable()
export class RiskScaleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(db: Prisma.TransactionClient = this.prisma): Promise<RiskScaleDto | null> {
    const scale = await latest(db);
    return scale ? toDto(scale) : null;
  }

  /**
   * The scale a risk is assessed against now: the latest version's id and appetite, or no id
   * and the default appetite while the organisation has not adopted a scale.
   */
  async currentAppetite(
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ riskScaleId: string | null; appetiteThreshold: number }> {
    const scale = await db.riskScale.findFirst({
      orderBy: { version: "desc" },
      select: { id: true, appetiteThreshold: true },
    });
    return scale
      ? { riskScaleId: scale.id, appetiteThreshold: scale.appetiteThreshold }
      : { riskScaleId: null, appetiteThreshold: DEFAULT_APPETITE_THRESHOLD };
  }

  /** Same appetite as the latest version: nothing is written and that version is returned. */
  set(input: RiskScaleInput, ctx: AuditContext): Promise<RiskScaleDto> {
    const createdById = ctx.actorUserId;
    if (createdById === null) throw new Error("A risk scale needs an acting user");
    return withSetupLock(this.prisma, async (tx) => {
      const previous = await latest(tx);
      if (previous?.appetiteThreshold === input.appetiteThreshold) return toDto(previous);
      const levels = (["likelihood", "impact"] as const).flatMap((axis) =>
        DEFAULT_RISK_SCALE[axis].map((l) => ({ axis, ...l })),
      );
      const created = await tx.riskScale.create({
        data: {
          version: (previous?.version ?? 0) + 1,
          appetiteThreshold: input.appetiteThreshold,
          createdById,
          levels: { create: levels },
        },
        select: SCALE_SELECT,
      });
      await this.audit.record(
        {
          action: "organisation.risk_scale_created",
          objectType: "RiskScale",
          objectId: created.id,
          after: { version: created.version, appetiteThreshold: created.appetiteThreshold },
        },
        ctx,
        tx,
      );
      return toDto(created);
    });
  }
}
