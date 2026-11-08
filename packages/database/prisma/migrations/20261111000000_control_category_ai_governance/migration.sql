-- Issue #16 (EU AI Act, slice 1): the AIG- controls get their own category. The enum value
-- lives in its own migration because a new value cannot be used in the transaction that adds it.
ALTER TYPE "ControlCategory" ADD VALUE 'ai_governance';
