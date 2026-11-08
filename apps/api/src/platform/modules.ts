import type { ModuleKey } from "@isms/contracts";
import type { Prisma } from "@isms/database";

type Db = Pick<Prisma.TransactionClient, "organisationModule">;

/** The optional modules switched on, in key order (#16 §1: a row present means on). */
export async function enabledModules(db: Db): Promise<ModuleKey[]> {
  const rows = await db.organisationModule.findMany({
    select: { key: true },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => r.key);
}

/** Whether one module is on. */
export async function isModuleEnabled(db: Db, key: ModuleKey): Promise<boolean> {
  return (await db.organisationModule.count({ where: { key } })) > 0;
}
