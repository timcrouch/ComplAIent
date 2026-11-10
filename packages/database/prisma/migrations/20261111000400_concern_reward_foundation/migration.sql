CREATE TYPE "ConcernEvaluationStatus" AS ENUM ('pending', 'provisional', 'final', 'overridden', 'suspended');
CREATE TYPE "ConcernEvaluationSource" AS ENUM ('ai', 'ciso');
CREATE TYPE "ConcernLegitimacy" AS ENUM ('confirmed', 'plausible', 'confirmed_duplicate', 'not_confirmed', 'out_of_scope', 'abusive');
CREATE TYPE "ConcernSeverity" AS ENUM ('informational', 'minor', 'moderate', 'major', 'critical');
CREATE TYPE "ConcernRewardEntryKind" AS ENUM ('award', 'adjustment');

CREATE TABLE "ConcernDuplicateGroup" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConcernDuplicateGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConcernEvaluation" (
  "id" UUID NOT NULL,
  "riskId" UUID NOT NULL,
  "reporterId" UUID NOT NULL,
  "status" "ConcernEvaluationStatus" NOT NULL DEFAULT 'pending',
  "source" "ConcernEvaluationSource",
  "legitimacy" "ConcernLegitimacy",
  "severity" "ConcernSeverity",
  "duplicateGroupId" UUID,
  "duplicatePosition" INTEGER,
  "legitimacyPoints" INTEGER NOT NULL DEFAULT 0,
  "severityPoints" INTEGER NOT NULL DEFAULT 0,
  "positionPoints" INTEGER NOT NULL DEFAULT 0,
  "totalPoints" INTEGER NOT NULL DEFAULT 0,
  "feedback" TEXT,
  "evaluatedById" UUID,
  "evaluatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConcernEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConcernRewardEntry" (
  "id" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" "ConcernRewardEntryKind" NOT NULL,
  "points" INTEGER NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConcernRewardEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConcernEvaluation_riskId_key" ON "ConcernEvaluation"("riskId");
CREATE INDEX "ConcernEvaluation_status_createdAt_idx" ON "ConcernEvaluation"("status", "createdAt");
CREATE INDEX "ConcernEvaluation_reporterId_createdAt_idx" ON "ConcernEvaluation"("reporterId", "createdAt");
CREATE UNIQUE INDEX "ConcernEvaluation_duplicateGroupId_duplicatePosition_key" ON "ConcernEvaluation"("duplicateGroupId", "duplicatePosition");
CREATE INDEX "ConcernRewardEntry_userId_createdAt_idx" ON "ConcernRewardEntry"("userId", "createdAt");
CREATE INDEX "ConcernRewardEntry_evaluationId_createdAt_idx" ON "ConcernRewardEntry"("evaluationId", "createdAt");

ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "ConcernDuplicateGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernRewardEntry" ADD CONSTRAINT "ConcernRewardEntry_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ConcernEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernRewardEntry" ADD CONSTRAINT "ConcernRewardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConcernRewardEntry" ADD CONSTRAINT "ConcernRewardEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_position_check" CHECK ("duplicatePosition" IS NULL OR "duplicatePosition" > 0);
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_points_check" CHECK ("legitimacyPoints" >= 0 AND "severityPoints" >= 0 AND "positionPoints" >= 0 AND "totalPoints" >= 0);
ALTER TABLE "ConcernEvaluation" ADD CONSTRAINT "ConcernEvaluation_feedback_check" CHECK ("feedback" IS NULL OR char_length("feedback") BETWEEN 1 AND 2000);
ALTER TABLE "ConcernRewardEntry" ADD CONSTRAINT "ConcernRewardEntry_note_check" CHECK (char_length("note") <= 1000);

GRANT SELECT, INSERT, UPDATE ON "ConcernEvaluation" TO isms_app;
GRANT SELECT, INSERT ON "ConcernDuplicateGroup", "ConcernRewardEntry" TO isms_app;
REVOKE DELETE, TRUNCATE ON "ConcernEvaluation", "ConcernDuplicateGroup", "ConcernRewardEntry" FROM isms_app;
REVOKE UPDATE ON "ConcernDuplicateGroup", "ConcernRewardEntry" FROM isms_app;
