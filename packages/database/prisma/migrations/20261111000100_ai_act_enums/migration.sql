-- EU AI Act module (#16): the two AI purposes. Enum additions live in their own migration
-- because a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "AiPurpose" ADD VALUE 'ai_act_classification';
ALTER TYPE "AiPurpose" ADD VALUE 'ai_act_obligation_guidance';
