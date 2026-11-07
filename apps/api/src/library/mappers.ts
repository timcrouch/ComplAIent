import type { LibraryExportRow, MappingDto, MappingReviewDto } from "@isms/contracts";
import { Prisma } from "@isms/database";

/** Everything a mapping's DTO and export row need. */
export const MAPPING_SELECT = {
  id: true,
  reviewedAt: true,
  reviewedBy: { select: { id: true, displayName: true } },
  requirement: {
    select: {
      ref: true,
      title: true,
      sortOrder: true,
      frameworkVersion: {
        select: { key: true, label: true, framework: { select: { key: true, name: true } } },
      },
    },
  },
} as const satisfies Prisma.ControlRequirementMappingSelect;

export type StoredMapping = Prisma.ControlRequirementMappingGetPayload<{
  select: typeof MAPPING_SELECT;
}>;

export function toReview(m: Pick<StoredMapping, "reviewedAt" | "reviewedBy">): MappingReviewDto {
  return m.reviewedAt && m.reviewedBy
    ? {
        status: "reviewed",
        reviewedBy: { id: m.reviewedBy.id, displayName: m.reviewedBy.displayName },
        reviewedAt: m.reviewedAt.toISOString(),
      }
    : { status: "unreviewed" };
}

export function toMappingDto(m: StoredMapping): MappingDto {
  const version = m.requirement.frameworkVersion;
  return {
    id: m.id,
    frameworkVersionKey: version.key,
    frameworkName: version.framework.name,
    versionLabel: version.label,
    requirementRef: m.requirement.ref,
    requirementTitle: m.requirement.title,
    review: toReview(m),
  };
}

/** Order of a control's mappings: framework version key, then the requirement's sort order. */
export function compareMappings(a: StoredMapping, b: StoredMapping): number {
  const ka = a.requirement.frameworkVersion.key;
  const kb = b.requirement.frameworkVersion.key;
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.requirement.sortOrder - b.requirement.sortOrder;
}

export function toExportRow(
  control: { code: string; title: string; category: LibraryExportRow["category"] },
  m: StoredMapping,
): LibraryExportRow {
  const dto = toMappingDto(m);
  return {
    controlCode: control.code,
    controlTitle: control.title,
    category: control.category,
    frameworkVersionKey: dto.frameworkVersionKey,
    frameworkName: dto.frameworkName,
    requirementRef: dto.requirementRef,
    requirementTitle: dto.requirementTitle,
    reviewStatus: dto.review.status,
    reviewedBy: dto.review.status === "reviewed" ? dto.review.reviewedBy.displayName : null,
    reviewedAt: dto.review.status === "reviewed" ? dto.review.reviewedAt : null,
  };
}
