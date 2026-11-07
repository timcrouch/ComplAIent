import type { PrismaClient } from "@isms/database";
import { z } from "zod";
import {
  defaultAiSettings,
  type AiModels,
  type AiOutcome,
  type AiSettingsRow,
  type AiStore,
  type InteractionRecord,
} from "./store.js";

/** A client or a transaction client; only the two AI tables are used. */
export type AiStoreDb = Pick<PrismaClient, "aiSettings" | "aiInteraction">;

const ModelId = z.string().min(1).max(200);

/** Keeps only well-formed model ids; anything else in the JSON column is ignored. */
export function parseModels(value: unknown): AiModels {
  const models: AiModels = {};
  if (typeof value !== "object" || value === null) return models;
  const record = value as Record<string, unknown>;
  for (const key of ["conversation", "controls", "frameworks"] as const) {
    const parsed = ModelId.safeParse(record[key]);
    if (parsed.success) models[key] = parsed.data;
  }
  return models;
}

export function createPrismaAiStore(db: AiStoreDb): AiStore {
  return {
    async loadSettings(): Promise<AiSettingsRow> {
      // findFirst, not findUnique: Prisma batches same-tick findUnique calls into one query
      // with `singleton: { in: [...] }`, and a Boolean field has no `in` filter.
      const row = await db.aiSettings.findFirst({ where: { singleton: true } });
      if (!row) return defaultAiSettings();
      return {
        enabled: row.enabled,
        euOnly: row.euOnly,
        zeroRetention: row.zeroRetention,
        sealedKey: row.sealedKey ? Buffer.from(row.sealedKey) : null,
        keyLast4: row.keyLast4,
        keySetById: row.keySetById,
        keySetAt: row.keySetAt,
        models: parseModels(row.models),
        updatedById: row.updatedById,
        updatedAt: row.updatedAt,
      };
    },

    async recordInteraction(r: InteractionRecord): Promise<string> {
      const row = await db.aiInteraction.create({
        data: {
          purpose: r.purpose,
          provider: r.provider,
          model: r.model,
          routing: r.routing,
          request: {
            system: r.request.system,
            messages: r.request.messages.map((m) => ({ ...m })),
          },
          response: r.response,
          status: r.status,
          attempts: r.attempts,
          durationMs: r.durationMs,
          actorUserId: r.actorUserId,
          objectType: r.objectType,
          objectId: r.objectId,
        },
        select: { id: true },
      });
      return row.id;
    },

    async setOutcome(id: string, outcome: AiOutcome): Promise<void> {
      await db.aiInteraction.update({ where: { id }, data: { outcome }, select: { id: true } });
    },

    async setDiscardedCount(id: string, count: number): Promise<void> {
      if (!Number.isInteger(count) || count < 0)
        throw new Error("discardedCount must be a non-negative integer");
      await db.aiInteraction.update({
        where: { id },
        data: { discardedCount: count },
        select: { id: true },
      });
    },
  };
}
