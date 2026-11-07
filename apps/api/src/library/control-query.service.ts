import { Inject, Injectable } from "@nestjs/common";
import type {
  ControlDetailDto,
  ControlListQuery,
  ControlListResponse,
  ExportLibraryResponse,
} from "@isms/contracts";
import { type Clock, DomainError } from "@isms/domain";
import type { Prisma } from "@isms/database";
import { CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { controlSearchIds } from "./control-search.js";
import { MAPPING_SELECT, compareMappings, toExportRow, toMappingDto } from "./mappers.js";

const CONTROL_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  guidance: true,
  category: true,
  libraryVersion: true,
  mappings: { select: MAPPING_SELECT },
} as const satisfies Prisma.ControlSelect;

/** Reads of the control library: search, detail and export. */
@Injectable()
export class ControlQueryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async libraryVersion(): Promise<string | null> {
    const first = await this.prisma.control.findFirst({
      orderBy: { code: "asc" },
      select: { libraryVersion: true },
    });
    return first?.libraryVersion ?? null;
  }

  async list(query: ControlListQuery): Promise<ControlListResponse> {
    const where: Prisma.ControlWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.framework) {
      where.mappings = {
        some: { requirement: { frameworkVersion: { key: query.framework } } },
      };
    }
    if (query.q) where.id = { in: await controlSearchIds(this.prisma, query.q) };

    const [controls, inUseIds, latest] = await Promise.all([
      this.prisma.control.findMany({
        where,
        orderBy: { code: "asc" },
        select: CONTROL_SELECT,
      }),
      // Library metadata: accepted on any risk, whoever may see that risk.
      this.prisma.riskControl.findMany({
        where: { status: "accepted" },
        distinct: ["controlId"],
        select: { controlId: true },
      }),
      this.prisma.controlTest.findMany({
        orderBy: [{ testedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        distinct: ["controlId"],
        select: { controlId: true, result: true },
      }),
    ]);
    const used = new Set(inUseIds.map((r) => r.controlId));
    const latestResult = new Map(latest.map((t) => [t.controlId, t.result]));
    // Bounded library: the review filter is applied here, within the framework filter.
    const items = controls
      .filter((c) => query.inUse === undefined || used.has(c.id) === (query.inUse === "true"))
      .filter((c) => {
        if (query.review === "all") return true;
        const considered = query.framework
          ? c.mappings.filter((m) => m.requirement.frameworkVersion.key === query.framework)
          : c.mappings;
        const allReviewed = considered.every((m) => m.reviewedAt !== null);
        return query.review === "reviewed" ? allReviewed : !allReviewed;
      })
      .map((c) => ({
        code: c.code,
        title: c.title,
        category: c.category,
        frameworks: [...new Set(c.mappings.map((m) => m.requirement.frameworkVersion.key))].sort(),
        mappings: {
          total: c.mappings.length,
          reviewed: c.mappings.filter((m) => m.reviewedAt !== null).length,
        },
        inUse: used.has(c.id),
        latestResult: latestResult.get(c.id) ?? null,
      }));
    return { libraryVersion: await this.libraryVersion(), items };
  }

  async get(code: string): Promise<ControlDetailDto> {
    const control = await this.prisma.control.findUnique({
      where: { code },
      select: CONTROL_SELECT,
    });
    if (!control) throw new DomainError("NOT_FOUND", "Not found");
    return {
      code: control.code,
      title: control.title,
      description: control.description,
      guidance: control.guidance,
      category: control.category,
      libraryVersion: control.libraryVersion,
      mappings: [...control.mappings].sort(compareMappings).map(toMappingDto),
    };
  }

  async export(): Promise<ExportLibraryResponse> {
    const controls = await this.prisma.control.findMany({
      orderBy: { code: "asc" },
      select: CONTROL_SELECT,
    });
    return {
      libraryVersion: await this.libraryVersion(),
      generatedAt: this.clock.now().toISOString(),
      rows: controls.flatMap((c) =>
        [...c.mappings].sort(compareMappings).map((m) => toExportRow(c, m)),
      ),
    };
  }
}
