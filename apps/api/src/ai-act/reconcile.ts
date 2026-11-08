import type { Prisma } from "@isms/database";
import { AI_OBLIGATION_KEYS, type AiObligationKey } from "@isms/domain";

/** Catalogue position; a key no longer in the catalogue sorts last. */
const position = (key: string): number => {
  const i = AI_OBLIGATION_KEYS.indexOf(key as AiObligationKey);
  return i === -1 ? AI_OBLIGATION_KEYS.length : i;
};

/** What a reconciliation changes, by catalogue key; also the audit payload. */
export type ReconcilePlan = {
  /** New applicable keys: inserted as open with an empty note. */
  added: AiObligationKey[];
  /** Stored rows that apply again: applicable set to true, status and note kept. */
  nowApplicable: string[];
  /** Stored rows that no longer apply: applicable set to false, never deleted. */
  nowInapplicable: string[];
};

/**
 * The changes that bring the stored obligation rows in line with the keys that apply now
 * (spec §5). A stored row keeps its status and note whatever happens; nothing is deleted.
 * Every list is in catalogue order.
 */
export function planReconciliation(
  stored: readonly { key: string; applicable: boolean }[],
  applicable: readonly AiObligationKey[],
): ReconcilePlan {
  const want = new Set<string>(applicable);
  const have = new Set(stored.map((row) => row.key));
  const rows = [...stored].sort((a, b) => position(a.key) - position(b.key));
  return {
    added: [...applicable].sort((a, b) => position(a) - position(b)).filter((k) => !have.has(k)),
    nowApplicable: rows.filter((r) => !r.applicable && want.has(r.key)).map((r) => r.key),
    nowInapplicable: rows.filter((r) => r.applicable && !want.has(r.key)).map((r) => r.key),
  };
}

/** Applies the plan inside the caller's transaction (which holds the system's row lock). */
export async function reconcileObligations(
  tx: Prisma.TransactionClient,
  aiSystemId: string,
  applicable: readonly AiObligationKey[],
): Promise<ReconcilePlan> {
  const stored = await tx.aiSystemObligation.findMany({
    where: { aiSystemId },
    select: { key: true, applicable: true },
  });
  const plan = planReconciliation(stored, applicable);
  if (plan.added.length > 0)
    await tx.aiSystemObligation.createMany({
      data: plan.added.map((key) => ({ aiSystemId, key, applicable: true, status: "open" })),
    });
  for (const [keys, value] of [
    [plan.nowApplicable, true],
    [plan.nowInapplicable, false],
  ] as const) {
    if (keys.length > 0)
      await tx.aiSystemObligation.updateMany({
        where: { aiSystemId, key: { in: keys } },
        data: { applicable: value },
      });
  }
  return plan;
}

/** True when the plan changes nothing. */
export const isEmptyPlan = (plan: ReconcilePlan): boolean =>
  plan.added.length + plan.nowApplicable.length + plan.nowInapplicable.length === 0;
