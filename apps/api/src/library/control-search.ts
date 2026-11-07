import type { PrismaService } from "../platform/index.js";

/** Escapes LIKE wildcards so user text is matched literally. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Ids of the controls matching free text. A control matches when its code starts with the
 * text, when its words match (websearch syntax: user text is never parsed as a raw tsquery),
 * or when one of its mapped requirements has exactly that reference. Control characters count
 * as spaces. Empty text matches nothing here; the caller skips the search instead.
 *
 * No index: the library is bounded at a few hundred rows, so a scan is cheaper than the
 * index's upkeep. Add a GIN index on the tsvector if that ever changes.
 */
export async function controlSearchIds(db: PrismaService, q: string): Promise<string[]> {
  // Postgres text cannot hold NUL, and no control character means anything in a search.
  // eslint-disable-next-line no-control-regex
  const text = q.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  if (text === "") return [];
  const codePrefix = `${escapeLike(text)}%`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "Control" c
    WHERE c."code" ILIKE ${codePrefix} ESCAPE '\\'
      OR to_tsvector('english', c."title" || ' ' || c."description" || ' ' || array_to_string(c."guidance", ' '))
         @@ websearch_to_tsquery('english', ${text})
      OR EXISTS (
        SELECT 1
        FROM "ControlRequirementMapping" m
        JOIN "Requirement" r ON r."id" = m."requirementId"
        WHERE m."controlId" = c."id" AND lower(r."ref") = lower(${text})
      )`;
  return rows.map((r) => r.id);
}
