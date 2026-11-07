import type { AssetInput } from "@isms/contracts";
import type { Prisma } from "@isms/database";

type Tx = Prisma.TransactionClient;

/** Name keys exactly as the database's check constraint derives them, `lower(btrim(name))`. */
async function nameKeys(tx: Tx, names: readonly string[]): Promise<string[]> {
  const rows = await tx.$queryRaw<{ key: string }[]>`
    SELECT lower(btrim(t.name)) AS key
    FROM unnest(${[...names]}::text[]) WITH ORDINALITY AS t(name, i)
    ORDER BY t.i`;
  return rows.map((r) => r.key);
}

/**
 * The asset ids for affected-asset inputs, in input order without repeats (P3-R14). An
 * existing asset with the same name ignoring case and the same type is reused; otherwise one
 * is created at `siteId`. Concurrent creations of the same asset settle on one row.
 */
export async function resolveAssets(
  tx: Tx,
  inputs: readonly AssetInput[],
  siteId: string | null,
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const keys = await nameKeys(
    tx,
    inputs.map((i) => i.name),
  );
  const wanted = inputs.map((input, i) => ({ ...input, nameKey: keys[i] ?? "" }));
  await tx.asset.createMany({
    data: wanted.map((w) => ({ name: w.name, nameKey: w.nameKey, type: w.type, siteId })),
    skipDuplicates: true,
  });
  const stored = await tx.asset.findMany({
    where: { OR: wanted.map((w) => ({ nameKey: w.nameKey, type: w.type })) },
    select: { id: true, nameKey: true, type: true },
  });
  const ids: string[] = [];
  for (const w of wanted) {
    const found = stored.find((s) => s.nameKey === w.nameKey && s.type === w.type);
    if (!found) throw new Error("A resolved asset is missing");
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}
