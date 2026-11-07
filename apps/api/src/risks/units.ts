import type { Prisma } from "@isms/database";
import { DomainError, type ErrorDetail } from "@isms/domain";

/**
 * Refuses (400, at `<prefix>siteId` / `<prefix>departmentId`) a site or department that does
 * not exist, so a stale id never reaches the foreign key as a 500.
 */
export async function assertUnitsExist(
  tx: Prisma.TransactionClient,
  units: { siteId?: string | null | undefined; departmentId?: string | null | undefined },
  prefix: string,
): Promise<void> {
  const invalid: ErrorDetail[] = [];
  const { siteId, departmentId } = units;
  if (
    typeof siteId === "string" &&
    !(await tx.site.findUnique({ where: { id: siteId }, select: { id: true } }))
  )
    invalid.push({ path: `${prefix}siteId`, message: "Unknown site" });
  if (
    typeof departmentId === "string" &&
    !(await tx.department.findUnique({ where: { id: departmentId }, select: { id: true } }))
  )
    invalid.push({ path: `${prefix}departmentId`, message: "Unknown department" });
  if (invalid.length > 0)
    throw new DomainError("VALIDATION_FAILED", "Request validation failed", invalid);
}
