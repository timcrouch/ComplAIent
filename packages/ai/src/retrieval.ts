import type { PrismaClient } from "@isms/database";
import {
  contentHash,
  controlEmbeddingText,
  EMBEDDING_DIMENSIONS,
  type Embedder,
} from "./embedder.js";

/** The app-role client (or a transaction client): the control library and raw SQL. */
export type RetrievalDb = Pick<PrismaClient, "control" | "$executeRaw" | "$queryRaw">;

export type NearestControl = {
  controlId: string;
  code: string;
  title: string;
  description: string;
  /** Mapped requirement references, as "<framework version key> <ref>" (no requirement text). */
  refs: string[];
};

const BATCH = 32;
const MAX_K = 100;

/** pgvector's text form, bound as a parameter and cast with `::vector` (never spliced into SQL). */
export function toVectorLiteral(vector: Float32Array): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${String(EMBEDDING_DIMENSIONS)} dimensions`);
  }
  const parts: string[] = [];
  for (const x of vector) {
    if (!Number.isFinite(x)) throw new Error("Embedding contains a non-finite value");
    parts.push(String(x));
  }
  return `[${parts.join(",")}]`;
}

/**
 * Embeds the controls that have no embedding yet, or one from another model or of other text.
 * Embeddings are derived data: rebuilding them is always safe.
 */
export async function ensureLibraryEmbedded(
  db: RetrievalDb,
  embedder: Embedder,
): Promise<{ embedded: number }> {
  const controls = await db.control.findMany({
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      guidance: true,
      embedding: { select: { model: true, contentHash: true } },
    },
    orderBy: { code: "asc" },
  });
  const stale = controls
    .map((c) => {
      const text = controlEmbeddingText(c);
      return { id: c.id, text, hash: contentHash(text), current: c.embedding };
    })
    .filter((c) => c.current?.model !== embedder.model || c.current.contentHash !== c.hash);

  for (let start = 0; start < stale.length; start += BATCH) {
    const batch = stale.slice(start, start + BATCH);
    const vectors = await embedder.embed(batch.map((c) => c.text));
    for (const [i, c] of batch.entries()) {
      const vector = vectors[i];
      if (!vector) throw new Error("The embedder returned fewer vectors than texts");
      const literal = toVectorLiteral(vector);
      await db.$executeRaw`
        INSERT INTO "ControlEmbedding" ("controlId", "model", "contentHash", "embedding")
        VALUES (${c.id}::uuid, ${embedder.model}, ${c.hash}, ${literal}::vector)
        ON CONFLICT ("controlId") DO UPDATE SET
          "model" = EXCLUDED."model",
          "contentHash" = EXCLUDED."contentHash",
          "embedding" = EXCLUDED."embedding",
          "createdAt" = CURRENT_TIMESTAMP`;
    }
  }
  return { embedded: stale.length };
}

/** The k library controls nearest to `vector` by cosine distance, nearest first. */
export async function nearestControls(
  db: RetrievalDb,
  vector: Float32Array,
  k: number,
): Promise<NearestControl[]> {
  const limit = Math.min(Math.max(Math.trunc(k), 1), MAX_K);
  const literal = toVectorLiteral(vector);
  return db.$queryRaw<NearestControl[]>`
    SELECT c."id"::text AS "controlId", c."code", c."title", c."description",
      COALESCE(
        (SELECT array_agg(fv."key" || ' ' || r."ref" ORDER BY fv."key", r."sortOrder", r."ref")
           FROM "ControlRequirementMapping" m
           JOIN "Requirement" r ON r."id" = m."requirementId"
           JOIN "FrameworkVersion" fv ON fv."id" = r."frameworkVersionId"
          WHERE m."controlId" = c."id"),
        ARRAY[]::text[]
      ) AS "refs"
    FROM "ControlEmbedding" e
    JOIN "Control" c ON c."id" = e."controlId"
    ORDER BY e."embedding" <=> ${literal}::vector, c."code"
    LIMIT ${limit}`;
}
