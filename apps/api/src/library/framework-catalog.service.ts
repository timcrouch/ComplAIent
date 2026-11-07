import { Inject, Injectable } from "@nestjs/common";
import type { FrameworkVersionDto } from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { PRISMA, type PrismaService } from "../platform/index.js";

const VERSION_SELECT = {
  id: true,
  key: true,
  label: true,
  framework: { select: { key: true, name: true, summary: true } },
  _count: { select: { requirements: true } },
} as const satisfies Prisma.FrameworkVersionSelect;

type StoredVersion = Prisma.FrameworkVersionGetPayload<{ select: typeof VERSION_SELECT }>;

const toDto = (v: StoredVersion): FrameworkVersionDto => ({
  id: v.id,
  key: v.key,
  frameworkKey: v.framework.key,
  name: v.framework.name,
  versionLabel: v.label,
  summary: v.framework.summary,
  requirementCount: v._count.requirements,
});

/** The framework versions in the control library. Also used by organisation setup. */
@Injectable()
export class FrameworkCatalog {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async list(): Promise<FrameworkVersionDto[]> {
    const versions = await this.prisma.frameworkVersion.findMany({
      orderBy: { key: "asc" },
      select: VERSION_SELECT,
    });
    return versions.map(toDto);
  }

  async findByIds(ids: readonly string[]): Promise<FrameworkVersionDto[]> {
    if (ids.length === 0) return [];
    const versions = await this.prisma.frameworkVersion.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { key: "asc" },
      select: VERSION_SELECT,
    });
    return versions.map(toDto);
  }
}
