import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@isms/database";
import type { Clock } from "@isms/domain";
import { type AuditContext, AuditService } from "../audit/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import type { Actor } from "./actor.js";
import type { VerifiedToken } from "./jwt-verifier.js";
import { toRoleAssignmentDto } from "./role-scope.js";

/** `lastSeenAt` is written at most this often; profile changes are written at once. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 300_000;

export const PROVISIONING_OPTIONS = Symbol("PROVISIONING_OPTIONS");

/**
 * The transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtext(...))`) under which
 * every check of "is there an administrator" and the change it guards run: the bootstrap
 * grant here and role revocation in RoleAssignmentService.
 */
export const BOOTSTRAP_ADMIN_LOCK = "isms:bootstrap-admin";

/**
 * `@isms/demo` DEMO_LOCK: the demo load and reset take it exclusively before they truncate. In
 * demo mode a sign-in takes it shared around its claim and upsert (#7), so the two never
 * interleave: a sign-in waits for a running load, and a load waits for running sign-ins.
 */
export const DEMO_LOCK = "isms:demo";

/** Prefix of the per-identity lock that orders concurrent sign-ins of one identity in demo mode. */
const SIGN_IN_LOCK = "isms:sign-in:";

/**
 * A sign-in may wait out a whole load (`@isms/demo` DEMO_TRANSACTION_OPTIONS allows 120 s), so
 * its transaction may last as long.
 */
const FENCED_SIGN_IN_OPTIONS = { maxWait: 30_000, timeout: 130_000 } as const;

export type ProvisioningOptions = {
  bootstrapAdminEmail: string | undefined;
  clock: Clock;
  /** Demo mode (DEMO_TOOLS_ENABLED): sample placeholders may be claimed on sign-in (P9-R3). */
  demoTools: boolean;
};

/** The sample generator's placeholder issuer (`@isms/demo` PENDING_ISSUER). */
const PENDING_ISSUER = "pending:";
/** The reserved sample domain: the only addresses besides the bootstrap one a claim accepts. */
const SAMPLE_DOMAIN = "@example.test";

/** Request context for the audit trail of anything provisioning grants. */
export type ProvisioningContext = Omit<AuditContext, "actorUserId">;

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Maps a verified token to an application user (keyed on issuer + subject), refreshing
 * profile fields on every sign-in, and applies the one-time bootstrap administrator rule.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(PROVISIONING_OPTIONS) private readonly options: ProvisioningOptions,
    private readonly audit: AuditService,
  ) {}

  async resolve(token: VerifiedToken, request: ProvisioningContext): Promise<Actor> {
    const userId = this.options.demoTools
      ? await this.provisionFenced(token, request)
      : await this.upsertUser(this.prisma, token);
    let assignments = await this.assignmentsOf(userId);
    const isOrgAdmin = assignments.some(
      (a) => a.role === "administrator" && a.scopeType === "ORGANISATION",
    );
    // Already an organisation administrator: nothing to bootstrap, so skip the lock.
    if (
      !isOrgAdmin &&
      this.isBootstrapCandidate(token) &&
      (await this.grantBootstrapAdmin(userId, request))
    ) {
      assignments = await this.assignmentsOf(userId);
    }
    return {
      userId,
      email: token.email,
      authTime: token.authTime,
      authTimeSource: token.authTimeSource,
      roles: assignments.map(toRoleAssignmentDto),
    };
  }

  private assignmentsOf(userId: string) {
    return this.prisma.roleAssignment.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { role: true, scopeType: true, siteId: true, departmentId: true },
    });
  }

  /**
   * Demo mode: the claim and the upsert in one transaction under the shared demo lock (#7).
   * Without it, a load that ran between the claim's check (which found the user) and the
   * upsert's lookup (which then did not) left a second user for the email, with no roles,
   * beside the reloaded placeholder that holds them. The per-identity lock orders concurrent
   * sign-ins of one identity, so neither the claim nor the create can hit a unique violation
   * inside the transaction.
   */
  private provisionFenced(token: VerifiedToken, request: ProvisioningContext): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${DEMO_LOCK}))`;
      const identity = `${SIGN_IN_LOCK}${token.issuer} ${token.subject}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity}))`;
      if (this.isClaimCandidate(token)) await this.claimPlaceholder(tx, token, request);
      return this.upsertUser(tx, token);
    }, FENCED_SIGN_IN_OPTIONS);
  }

  private async upsertUser(db: Db, token: VerifiedToken): Promise<string> {
    const where = {
      idpIssuer_idpSubject: { idpIssuer: token.issuer, idpSubject: token.subject },
    };
    const select = { id: true, email: true, displayName: true, lastSeenAt: true } as const;
    const now = this.options.clock.now();
    const profile = { email: token.email, displayName: token.name };
    let existing = await db.user.findUnique({ where, select });
    if (!existing) {
      try {
        return (
          await db.user.create({
            data: {
              idpIssuer: token.issuer,
              idpSubject: token.subject,
              ...profile,
              lastSeenAt: now,
            },
            select: { id: true },
          })
        ).id;
      } catch (err) {
        // Two concurrent first sign-ins of one identity: the loser continues as an update.
        // (In demo mode the sign-in lock orders them, so this is never inside a transaction.)
        if (!isUniqueViolation(err) || db !== this.prisma) throw err;
        existing = await db.user.findUniqueOrThrow({ where, select });
      }
    }
    const stale =
      existing.lastSeenAt === null ||
      now.getTime() - existing.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS;
    if (existing.email !== token.email || existing.displayName !== token.name || stale) {
      await db.user.update({
        where: { id: existing.id },
        data: { ...profile, lastSeenAt: now },
        select: { id: true },
      });
    }
    return existing.id;
  }

  /**
   * P9-R3: demo mode on, a verified email, and either the reserved sample domain or the
   * bootstrap email (already trusted by config). Any other address is never claimable.
   */
  private isClaimCandidate(token: VerifiedToken): boolean {
    if (!this.options.demoTools || !token.emailVerified) return false;
    const email = token.email.trim().toLowerCase();
    const bootstrap = this.options.bootstrapAdminEmail?.trim().toLowerCase();
    return email.endsWith(SAMPLE_DOMAIN) || email === bootstrap;
  }

  /**
   * Sets the sign-in's issuer and subject on the sample placeholder with this email, so the
   * person keeps the placeholder's roles and history instead of becoming a second user. Only
   * when no user exists for (issuer, subject). One conditional UPDATE, re-checked under the row
   * lock: of two concurrent claims (two identities with one email) one changes the row and the
   * other changes none. Runs in `provisionFenced`'s transaction, under the identity's lock, so
   * (issuer, subject) cannot appear meanwhile. Audited when a row changes.
   */
  private async claimPlaceholder(
    tx: Prisma.TransactionClient,
    token: VerifiedToken,
    request: ProvisioningContext,
  ) {
    const known = await tx.user.findUnique({
      where: { idpIssuer_idpSubject: { idpIssuer: token.issuer, idpSubject: token.subject } },
      select: { id: true },
    });
    if (known) return;
    const email = token.email.trim();
    const claimed = await tx.$queryRaw<{ id: string; email: string }[]>`
      UPDATE "User" SET "idpIssuer" = ${token.issuer}, "idpSubject" = ${token.subject}
      WHERE "idpIssuer" = ${PENDING_ISSUER}
        AND id = (SELECT id FROM "User"
                  WHERE "idpIssuer" = ${PENDING_ISSUER} AND lower(email) = lower(${email})
                  ORDER BY id LIMIT 1)
      RETURNING id, email`;
    const row = claimed[0];
    if (claimed.length !== 1 || !row) return;
    await this.audit.record(
      {
        action: "identity.placeholder_claimed",
        objectType: "User",
        objectId: row.id,
        after: { email: row.email, idpIssuer: token.issuer },
      },
      { ...request, actorUserId: row.id },
      tx,
    );
  }

  private isBootstrapCandidate(token: VerifiedToken): boolean {
    const configured = this.options.bootstrapAdminEmail;
    return (
      configured !== undefined &&
      token.emailVerified &&
      token.email.trim().toLowerCase() === configured.trim().toLowerCase()
    );
  }

  /**
   * Grants organisation-scoped administrator only if no administrator exists. The check and
   * the insert run under one transaction-scoped advisory lock, so concurrent first sign-ins
   * are serialised and at most one of them can become administrator. The audit row is written
   * in the same transaction, so a grant never exists without it. Returns true if granted.
   */
  private grantBootstrapAdmin(userId: string, request: ProvisioningContext): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_ADMIN_LOCK}))`;
      const existing = await tx.roleAssignment.findFirst({
        where: { role: "administrator" },
        select: { id: true },
      });
      if (existing) return false;
      await tx.roleAssignment.create({
        data: {
          userId,
          role: "administrator",
          scopeType: "ORGANISATION",
          grantedById: userId,
        },
      });
      await this.audit.record(
        {
          action: "identity.bootstrap_admin",
          objectType: "User",
          objectId: userId,
          after: { role: "administrator", scope: "organisation" },
        },
        { ...request, actorUserId: userId },
        tx,
      );
      return true;
    });
  }
}
