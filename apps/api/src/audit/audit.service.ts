import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@isms/database";
import { activeTraceId } from "@isms/telemetry";
import type { Request } from "express";
import { PRISMA, type PrismaService, getRequestId } from "../platform/index.js";
import { isCredentialKey } from "./credential-keys.js";

/** What a snapshot may hold: plain JSON only (no Date, undefined or class instances). */
export type AuditJson = string | number | boolean | null | readonly AuditJson[] | AuditSnapshot;
export type AuditSnapshot = { readonly [key: string]: AuditJson };

export type AuditEventInput = {
  action: string;
  objectType: string;
  objectId: string;
  before?: AuditSnapshot | undefined;
  after?: AuditSnapshot | undefined;
};

export type AuditContext = { actorUserId: string | null; requestId: string; traceId?: string };

/** The parts of a request an audit context is built from (structural, to avoid a cycle). */
type AuditableRequest = Request & { actor?: { userId: string } | undefined };

/** Builds the audit context of the current request: actor, request id and active trace. */
export function auditContextFrom(request: AuditableRequest): AuditContext {
  const traceId = activeTraceId();
  return {
    actorUserId: request.actor?.userId ?? null,
    requestId: getRequestId(request),
    ...(traceId === undefined ? {} : { traceId }),
  };
}

/** Removes (not masks) every credential-named key, reporting each removed key's name. */
function stripSecrets(value: Prisma.JsonValue, dropped: string[]): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, dropped));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, Prisma.JsonValue> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined) continue;
    if (isCredentialKey(key)) dropped.push(key);
    else out[key] = stripSecrets(inner, dropped);
  }
  return out;
}

/**
 * Normalises a snapshot to plain JSON first (so `toJSON` output such as Dates is stripped
 * too, and a cycle fails loudly), then strips secrets. `undefined` and `null` become NULL.
 */
function toSnapshot(value: unknown, dropped: string[]): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) return undefined;
  const stripped = stripSecrets(JSON.parse(json) as Prisma.JsonValue, dropped);
  return stripped === null ? undefined : stripped;
}

/**
 * Appends to the audit history. Pass the caller's transaction client so the audit row
 * commits or rolls back with the change it describes; otherwise it is written on its own.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async record(
    e: AuditEventInput,
    ctx: AuditContext,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const dropped: string[] = [];
    const beforeRef = toSnapshot(e.before, dropped);
    const afterRef = toSnapshot(e.after, dropped);
    for (const droppedField of dropped) {
      this.logger.warn({ event: "audit.credential_key_dropped", action: e.action, droppedField });
    }
    await client.auditEvent.create({
      data: {
        actorUserId: ctx.actorUserId,
        action: e.action,
        objectType: e.objectType,
        objectId: e.objectId,
        ...(beforeRef === undefined ? {} : { beforeRef }),
        ...(afterRef === undefined ? {} : { afterRef }),
        requestId: ctx.requestId,
        traceId: ctx.traceId ?? null,
      },
      select: { id: true },
    });
  }
}
