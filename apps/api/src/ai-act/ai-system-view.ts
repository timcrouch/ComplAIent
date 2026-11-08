import {
  type AiClassificationDto,
  AiClassificationRecord,
  type AiObligationDto,
  type AiSystemDetailDto,
  type AiSystemSummaryDto,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import {
  AI_OBLIGATION_KEYS,
  type AiObligationKey,
  DomainError,
  aiObligation,
  formatRiskReference,
} from "@isms/domain";

const PERSON = { select: { id: true, displayName: true } } as const;

export const SUMMARY_SELECT = {
  id: true,
  name: true,
  role: true,
  status: true,
  riskClass: true,
  updatedAt: true,
  owner: PERSON,
  department: { select: { id: true, name: true } },
  _count: {
    select: {
      obligations: { where: { applicable: true, status: { in: ["open", "in_progress"] } } },
    },
  },
} as const satisfies Prisma.AiSystemSelect;
type SummaryRow = Prisma.AiSystemGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** The detail of a system, with only the risk links `visibleRisks` lets through. */
export const detailSelect = (visibleRisks: Prisma.AiSystemRiskWhereInput) =>
  ({
    ...SUMMARY_SELECT,
    description: true,
    intendedPurpose: true,
    supplier: true,
    model: true,
    usesGeneralPurposeModel: true,
    createdAt: true,
    classification: true,
    classifiedAt: true,
    classifiedBy: PERSON,
    obligations: {
      select: {
        key: true,
        applicable: true,
        status: true,
        note: true,
        updatedAt: true,
        updatedBy: PERSON,
      },
    },
    risks: {
      where: visibleRisks,
      orderBy: { risk: { reference: "asc" } },
      select: {
        linkedAt: true,
        linkedBy: PERSON,
        risk: { select: { id: true, reference: true, title: true, state: true } },
      },
    },
  }) as const satisfies Prisma.AiSystemSelect;
export type DetailRow = Prisma.AiSystemGetPayload<{ select: ReturnType<typeof detailSelect> }>;

export function toSummary(row: SummaryRow): AiSystemSummaryDto {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    riskClass: row.riskClass,
    owner: row.owner,
    department: row.department,
    openObligationCount: row._count.obligations,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The stored classification, checked against the contract: a bad row is a server fault. */
export function parseClassification(json: Prisma.JsonValue): AiClassificationRecord {
  const parsed = AiClassificationRecord.safeParse(json);
  if (!parsed.success) throw new DomainError("INTERNAL", "A stored AI classification is invalid");
  return parsed.data;
}

function toClassification(row: DetailRow): AiClassificationDto | null {
  if (row.classification === null || row.classifiedAt === null || row.classifiedBy === null)
    return null;
  const record = parseClassification(row.classification);
  return {
    answers: record.answers,
    source: record.source,
    result: record.result,
    classifiedAt: row.classifiedAt.toISOString(),
    classifiedBy: row.classifiedBy,
  };
}

const catalogueIndex = (key: string) => AI_OBLIGATION_KEYS.indexOf(key as AiObligationKey);

/** Applicable first, then the rest; each in catalogue order. */
function toObligations(rows: DetailRow["obligations"]): AiObligationDto[] {
  return [...rows]
    .sort(
      (a, b) =>
        Number(b.applicable) - Number(a.applicable) ||
        catalogueIndex(a.key) - catalogueIndex(b.key),
    )
    .map((o) => {
      const entry = aiObligation(o.key as AiObligationKey);
      return {
        key: entry.key,
        article: entry.article,
        applicable: o.applicable,
        status: o.status,
        note: o.note,
        updatedAt: o.updatedAt.toISOString(),
        updatedBy: o.updatedBy,
      };
    });
}

export function toDetail(
  row: DetailRow,
  ai: { canDraftClassification: boolean; canSuggestGuidance: boolean },
): AiSystemDetailDto {
  return {
    ...toSummary(row),
    description: row.description,
    intendedPurpose: row.intendedPurpose,
    supplier: row.supplier,
    model: row.model,
    usesGeneralPurposeModel: row.usesGeneralPurposeModel,
    createdAt: row.createdAt.toISOString(),
    classification: toClassification(row),
    obligations: toObligations(row.obligations),
    risks: row.risks.map((link) => ({
      id: link.risk.id,
      reference: formatRiskReference(link.risk.reference),
      title: link.risk.title,
      state: link.risk.state,
      linkedAt: link.linkedAt.toISOString(),
      linkedBy: link.linkedBy,
    })),
    ...ai,
  };
}
