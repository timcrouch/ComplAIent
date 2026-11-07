-- Plan 7 (reports): enum additions live in their own migration because a new enum value cannot
-- be used in the transaction that adds it.
ALTER TYPE "AiPurpose" ADD VALUE 'posture_summary';
ALTER TYPE "AiPurpose" ADD VALUE 'control_test_steps';
