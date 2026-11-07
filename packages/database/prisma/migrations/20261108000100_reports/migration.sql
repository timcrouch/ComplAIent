-- Plan 7 (reports): Statement of Applicability decisions and append-only board narratives.

-- CreateTable
CREATE TABLE "RequirementApplicability" (
    "requirementId" UUID NOT NULL,
    "applicable" BOOLEAN NOT NULL,
    "justification" TEXT NOT NULL,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RequirementApplicability_pkey" PRIMARY KEY ("requirementId")
);

-- CreateTable
CREATE TABLE "BoardNarrative" (
    "id" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "aiInteractionId" UUID,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BoardNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardNarrative_periodKey_approvedAt_idx" ON "BoardNarrative"("periodKey", "approvedAt");

-- AddForeignKey
ALTER TABLE "RequirementApplicability" ADD CONSTRAINT "RequirementApplicability_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementApplicability" ADD CONSTRAINT "RequirementApplicability_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardNarrative" ADD CONSTRAINT "BoardNarrative_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardNarrative" ADD CONSTRAINT "BoardNarrative_aiInteractionId_fkey" FOREIGN KEY ("aiInteractionId") REFERENCES "AiInteraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written tail: bounds and append-only.
ALTER TABLE "RequirementApplicability" ADD CONSTRAINT "RequirementApplicability_justification_check"
  CHECK (char_length("justification") BETWEEN 1 AND 2000);
ALTER TABLE "BoardNarrative" ADD CONSTRAINT "BoardNarrative_text_check"
  CHECK (char_length("text") BETWEEN 1 AND 6000);

-- The migration owner creates tables, so isms_app needs explicit grants (default privileges may
-- already cover them; GRANT is idempotent).
GRANT SELECT, INSERT, UPDATE, DELETE ON "RequirementApplicability" TO isms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BoardNarrative" TO isms_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "BoardNarrative" FROM isms_app;
