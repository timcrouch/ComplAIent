import type { AuditJson } from "../audit/index.js";

/**
 * Free text, which the audit trail records by length only: reports can name colleagues or
 * describe weaknesses, and the values stay in the visibility-gated RiskVersion.
 */
export const TEXT_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "scenario",
  "threat",
  "consequence",
  "existingSafeguards",
  "treatmentNote",
]);

/**
 * What the audit row records for one changed field. Free text is decided by the field alone,
 * never by the value's type: a text field cleared to null records length 0 and no `before`,
 * so the old text can never reach the audit trail.
 */
export function fieldAudit(
  field: string,
  before: AuditJson,
  next: AuditJson,
): { before?: AuditJson; after: AuditJson } {
  if (TEXT_FIELDS.has(field))
    return { after: { changed: true, length: typeof next === "string" ? next.length : 0 } };
  if (field === "toConfirm")
    return {
      before: { count: Array.isArray(before) ? before.length : 0 },
      after: { count: Array.isArray(next) ? next.length : 0 },
    };
  return { before, after: next };
}
