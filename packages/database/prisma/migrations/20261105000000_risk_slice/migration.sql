-- CreateEnum
CREATE TYPE "RiskState" AS ENUM ('proposed', 'in_review', 'approved', 'returned');

-- CreateEnum
CREATE TYPE "RiskTreatment" AS ENUM ('avoid', 'mitigate', 'transfer', 'accept');

-- CreateEnum
CREATE TYPE "ControlSuggestionStatus" AS ENUM ('none', 'pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "RiskControlStatus" AS ENUM ('suggested', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "SuggestionSource" AS ENUM ('ai', 'person');

-- CreateEnum
CREATE TYPE "EvidenceClassification" AS ENUM ('internal', 'confidential', 'restricted');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('evidence_request');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'returned');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'submitted', 'abandoned');

-- CreateEnum
CREATE TYPE "ConcernRole" AS ENUM ('reporter', 'assistant');

-- AlterTable
-- nameKey is backfilled before it becomes NOT NULL, so any existing row survives
ALTER TABLE "Asset" ADD COLUMN     "nameKey" TEXT;
UPDATE "Asset" SET "nameKey" = lower(btrim("name"));
ALTER TABLE "Asset" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateTable
CREATE TABLE "Risk" (
    "id" UUID NOT NULL,
    "reference" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "threat" TEXT NOT NULL,
    "consequence" TEXT NOT NULL,
    "existingSafeguards" TEXT NOT NULL DEFAULT '',
    "toConfirm" TEXT[],
    "likelihood" INTEGER,
    "impact" INTEGER,
    "riskScaleId" UUID,
    "aiLikelihood" INTEGER,
    "aiImpact" INTEGER,
    "aiReasoning" TEXT,
    "treatment" "RiskTreatment",
    "treatmentNote" TEXT NOT NULL DEFAULT '',
    "state" "RiskState" NOT NULL DEFAULT 'proposed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "ownerId" UUID,
    "reporterId" UUID NOT NULL,
    "reviewerId" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "siteId" UUID,
    "departmentId" UUID,
    "aiAssisted" BOOLEAN NOT NULL,
    "controlSuggestion" "ControlSuggestionStatus" NOT NULL DEFAULT 'none',
    "controlSuggestionFailure" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskVersion" (
    "id" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedFields" TEXT[],
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAsset" (
    "riskId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "RiskAsset_pkey" PRIMARY KEY ("riskId","assetId")
);

-- CreateTable
CREATE TABLE "RiskControl" (
    "id" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "status" "RiskControlStatus" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" "SuggestionSource" NOT NULL,
    "suggestedById" UUID,
    "aiInteractionId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "taskId" UUID,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "classification" "EvidenceClassification" NOT NULL DEFAULT 'internal',
    "uploadedById" UUID NOT NULL,
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceControl" (
    "evidenceId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "EvidenceControl_pkey" PRIMARY KEY ("evidenceId","controlId")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "assigneeId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "dueDate" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "riskId" UUID NOT NULL,
    "controlId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "approverId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernConversation" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "toConfirm" TEXT[],
    "draft" JSONB,
    "riskId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConcernConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "ConcernRole" NOT NULL,
    "text" TEXT NOT NULL,
    "chips" TEXT[],
    "notSure" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcernMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Risk_reference_key" ON "Risk"("reference");

-- CreateIndex
CREATE INDEX "Risk_state_idx" ON "Risk"("state");

-- CreateIndex
CREATE INDEX "Risk_reporterId_idx" ON "Risk"("reporterId");

-- CreateIndex
CREATE INDEX "Risk_ownerId_idx" ON "Risk"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskVersion_riskId_version_key" ON "RiskVersion"("riskId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskControl_riskId_controlId_key" ON "RiskControl"("riskId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_objectKey_key" ON "Evidence"("objectKey");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_riskId_version_decision_key" ON "Approval"("riskId", "version", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ConcernConversation_riskId_key" ON "ConcernConversation"("riskId");

-- CreateIndex
CREATE UNIQUE INDEX "ConcernMessage_conversationId_seq_key" ON "ConcernMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_nameKey_type_key" ON "Asset"("nameKey", "type");

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_riskScaleId_fkey" FOREIGN KEY ("riskScaleId") REFERENCES "RiskScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskVersion" ADD CONSTRAINT "RiskVersion_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskVersion" ADD CONSTRAINT "RiskVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAsset" ADD CONSTRAINT "RiskAsset_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAsset" ADD CONSTRAINT "RiskAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_suggestedById_fkey" FOREIGN KEY ("suggestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceControl" ADD CONSTRAINT "EvidenceControl_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceControl" ADD CONSTRAINT "EvidenceControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernConversation" ADD CONSTRAINT "ConcernConversation_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernConversation" ADD CONSTRAINT "ConcernConversation_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcernMessage" ADD CONSTRAINT "ConcernMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ConcernConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check constraints (Prisma cannot model them; `migrate diff` ignores them).
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_nameKey_check" CHECK ("nameKey" = lower(btrim("name")));

ALTER TABLE "Risk" ADD CONSTRAINT "Risk_likelihood_check" CHECK ("likelihood" IS NULL OR "likelihood" BETWEEN 1 AND 5);
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_impact_check" CHECK ("impact" IS NULL OR "impact" BETWEEN 1 AND 5);
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_aiLikelihood_check" CHECK ("aiLikelihood" IS NULL OR "aiLikelihood" BETWEEN 1 AND 5);
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_aiImpact_check" CHECK ("aiImpact" IS NULL OR "aiImpact" BETWEEN 1 AND 5);

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sizeBytes_check" CHECK ("sizeBytes" > 0);

-- Versions, evidence, approvals and conversation messages are append-only; evidence-to-control links are
-- insert-only. (New tables got full DML from the default privileges set in the init migration; the
-- Risk.reference sequence gets USAGE, SELECT the same way.)
REVOKE UPDATE, DELETE, TRUNCATE ON "RiskVersion", "Evidence", "EvidenceControl", "Approval", "ConcernMessage" FROM isms_app;
