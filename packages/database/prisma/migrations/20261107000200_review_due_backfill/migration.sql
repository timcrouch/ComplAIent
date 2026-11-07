-- Plan 6 data backfill: risks approved or closed before "nextReviewDue" existed get their review date,
-- the same rule as the app (reviewDueDate): the UTC date of approval (or closing) plus the
-- organisation's review interval in months (12 when no organisation row exists), clamped to month end.
-- Data only, and idempotent: rows that already have a date are left alone.
UPDATE "Risk"
SET "nextReviewDue" = (("approvedAt" AT TIME ZONE 'UTC')::date
  + make_interval(months => COALESCE((SELECT "reviewIntervalMonths" FROM "Organisation" LIMIT 1), 12)))::date
WHERE "state" = 'approved' AND "nextReviewDue" IS NULL AND "approvedAt" IS NOT NULL;

UPDATE "Risk"
SET "nextReviewDue" = (("closedAt" AT TIME ZONE 'UTC')::date
  + make_interval(months => COALESCE((SELECT "reviewIntervalMonths" FROM "Organisation" LIMIT 1), 12)))::date
WHERE "state" = 'closed' AND "nextReviewDue" IS NULL AND "closedAt" IS NOT NULL;
