-- Plan 6 (closing the loop): enum additions live in their own migration because a new enum
-- value cannot be used in the transaction that adds it (the next migration's partial index does).
ALTER TYPE "RiskState" ADD VALUE 'closed';
ALTER TYPE "TaskKind" ADD VALUE 'treatment_action';
ALTER TYPE "TaskKind" ADD VALUE 'periodic_review';
