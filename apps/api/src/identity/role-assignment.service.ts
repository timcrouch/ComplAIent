import { Inject, Injectable } from "@nestjs/common";
import {
  type GrantRoleRequest,
  type RoleAssignmentDetailDto,
  type UserSummaryDto,
  conflictDetail,
} from "@isms/contracts";
import { Prisma, type ScopeType } from "@isms/database";
import { DomainError } from "@isms/domain";
import { type AuditContext, AuditService, type AuditSnapshot } from "../audit/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { toRoleAssignmentDto } from "./role-scope.js";
import { BOOTSTRAP_ADMIN_LOCK } from "./user-provisioning.service.js";

const SCOPE_TYPE: Record<GrantRoleRequest["scope"]["type"], ScopeType> = {
  organisation: "ORGANISATION",
  site: "SITE",
  department: "DEPARTMENT",
};

/**
 * The columns of an assignment's DTO. `site` and `department` are a read-only join for
 * `scopeName`; this service never writes Site or Department rows.
 */
const ASSIGNMENT_SELECT = {
  id: true,
  userId: true,
  role: true,
  scopeType: true,
  siteId: true,
  departmentId: true,
  createdAt: true,
  site: { select: { name: true } },
  department: { select: { name: true } },
} as const satisfies Prisma.RoleAssignmentSelect;

type StoredAssignment = Prisma.RoleAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

function toDetailDto(a: StoredAssignment): RoleAssignmentDetailDto {
  return {
    id: a.id,
    userId: a.userId,
    ...toRoleAssignmentDto(a),
    scopeName: a.site?.name ?? a.department?.name ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** What the audit trail records about an assignment (before a revoke, after a grant). */
function snapshot(dto: RoleAssignmentDetailDto): AuditSnapshot {
  return { userId: dto.userId, role: dto.role, scopeType: dto.scope.type, scopeId: dto.scope.id };
}

const knownError = (err: unknown, code: string): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const notFound = (): DomainError => new DomainError("NOT_FOUND", "Not found");

/**
 * Lists users with their roles, and grants and revokes role assignments. Every change writes
 * its audit row in the same transaction. Revocation refuses to remove the last
 * organisation-scoped administrator (ADR-0005), checked under the bootstrap advisory lock.
 */
@Injectable()
export class RoleAssignmentService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUsers(): Promise<UserSummaryDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        email: true,
        displayName: true,
        lastSeenAt: true,
        roleAssignments: { orderBy: { createdAt: "asc" }, select: ASSIGNMENT_SELECT },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      roles: u.roleAssignments.map(toDetailDto),
    }));
  }

  /**
   * Unknown user: 404. A site or department that does not exist (foreign-key violation):
   * 400 on `scope.id`. The same assignment twice (unique violation): 409.
   */
  async grant(
    userId: string,
    input: GrantRoleRequest,
    ctx: AuditContext,
  ): Promise<RoleAssignmentDetailDto> {
    const grantedById = ctx.actorUserId;
    if (grantedById === null) throw new Error("A role grant needs an acting user");
    const { scope } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw notFound();
        const created = toDetailDto(
          await tx.roleAssignment.create({
            data: {
              userId,
              role: input.role,
              scopeType: SCOPE_TYPE[scope.type],
              siteId: scope.type === "site" ? scope.id : null,
              departmentId: scope.type === "department" ? scope.id : null,
              grantedById,
            },
            select: ASSIGNMENT_SELECT,
          }),
        );
        await this.audit.record(
          {
            action: "identity.role_granted",
            objectType: "RoleAssignment",
            objectId: created.id,
            after: snapshot(created),
          },
          ctx,
          tx,
        );
        return created;
      });
    } catch (err) {
      // The user was found in this transaction, so the only foreign key left is the unit.
      if (knownError(err, "P2003")) {
        throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
          { path: "scope.id", message: "No such site or department" },
        ]);
      }
      if (knownError(err, "P2002")) {
        throw new DomainError("CONFLICT", "The user already has this role at this scope", [
          conflictDetail("duplicateRoleAssignment"),
        ]);
      }
      throw err;
    }
  }

  /**
   * Removes an assignment, unless it is the only organisation-scoped administrator. The count
   * and the delete run under the bootstrap advisory lock, so two administrators revoking each
   * other at once are serialised and the second sees that only one remains.
   */
  revoke(assignmentId: string, ctx: AuditContext): Promise<RoleAssignmentDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_ADMIN_LOCK}))`;
      const stored = await tx.roleAssignment.findUnique({
        where: { id: assignmentId },
        select: ASSIGNMENT_SELECT,
      });
      if (!stored) throw notFound();
      if (stored.role === "administrator" && stored.scopeType === "ORGANISATION") {
        const admins = await tx.roleAssignment.count({
          where: { role: "administrator", scopeType: "ORGANISATION" },
        });
        if (admins <= 1) {
          throw new DomainError("CONFLICT", "The last organisation administrator stays", [
            conflictDetail("lastAdministrator"),
          ]);
        }
      }
      await tx.roleAssignment.delete({ where: { id: assignmentId }, select: { id: true } });
      const removed = toDetailDto(stored);
      await this.audit.record(
        {
          action: "identity.role_revoked",
          objectType: "RoleAssignment",
          objectId: removed.id,
          before: snapshot(removed),
        },
        ctx,
        tx,
      );
      return removed;
    });
  }
}
