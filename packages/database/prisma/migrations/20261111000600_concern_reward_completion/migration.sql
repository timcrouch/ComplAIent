CREATE TYPE "ConcernBadgeKey" AS ENUM ('first_signal', 'sharp_eye', 'early_warning', 'high_impact', 'consistent_guardian', 'corroborator');
CREATE TYPE "ConcernBadgeEventKind" AS ENUM ('awarded', 'revoked');

DROP INDEX "ConcernEvaluation_riskId_key";
ALTER TABLE "ConcernEvaluation"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "rationale" TEXT,
  ADD COLUMN "uncertainty" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "aiInteractionId" UUID,
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supersedesId" UUID;

ALTER TABLE "ConcernRewardEntry"
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "legitimacyPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "severityPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "positionPoints" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "ConcernEvaluation_riskId_version_key" ON "ConcernEvaluation"("riskId", "version");
CREATE UNIQUE INDEX "ConcernEvaluation_supersedesId_key" ON "ConcernEvaluation"("supersedesId");
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ConcernEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_rationale_check" CHECK ("rationale" IS NULL OR char_length("rationale") BETWEEN 1 AND 1000);
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_uncertainty_check" CHECK ("uncertainty" IS NULL OR char_length("uncertainty") <= 500);

CREATE TABLE "ConcernBadgeEvent" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "badgeKey" "ConcernBadgeKey" NOT NULL,
  "kind" "ConcernBadgeEventKind" NOT NULL,
  "evaluationId" UUID NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConcernBadgeEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConcernBadgeEvent_userId_badgeKey_evaluationId_kind_key" ON "ConcernBadgeEvent"("userId", "badgeKey", "evaluationId", "kind");
CREATE INDEX "ConcernBadgeEvent_userId_badgeKey_createdAt_idx" ON "ConcernBadgeEvent"("userId", "badgeKey", "createdAt");
ALTER TABLE "ConcernBadgeEvent" ADD CONSTRAINT "ConcernBadgeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernBadgeEvent" ADD CONSTRAINT "ConcernBadgeEvent_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ConcernEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON "ConcernBadgeEvent" TO isms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "ConcernBadgeEvent" FROM isms_app;
