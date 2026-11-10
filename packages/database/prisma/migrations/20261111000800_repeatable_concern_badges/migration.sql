-- Badge occurrences can be revoked and later re-awarded after another authoritative correction.
-- Idempotency is enforced from the current append-only event state under a per-user lock.
DROP INDEX IF EXISTS "ConcernBadgeEvent_userId_badgeKey_evaluationId_kind_key";
