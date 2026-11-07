import { ensureLibraryEmbedded, type Embedder, type RetrievalDb } from "@isms/ai";
import type { JobPayload } from "@isms/jobs";

/** `library.embed`: embeds new or changed library controls locally (derived data). */
export async function embedLibrary(
  deps: {
    db: RetrievalDb;
    embedder: Embedder;
    logger?: { info(obj: Record<string, unknown>, msg?: string): void };
  },
  payload: JobPayload<"library.embed">,
): Promise<{ embedded: number }> {
  const result = await ensureLibraryEmbedded(deps.db, deps.embedder);
  deps.logger?.info(
    { job: "library.embed", requestedAt: payload.requestedAt, embedded: result.embedded },
    "library embeddings up to date",
  );
  return result;
}
