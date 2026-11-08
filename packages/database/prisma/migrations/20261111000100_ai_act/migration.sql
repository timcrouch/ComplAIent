-- EU AI Act module (#16): optional modules, the AI system register, its obligations and its
-- links to risks. All four tables are mutable; their history lives in the audit trail.

-- CreateEnum
CREATE TYPE "AiActRole" AS ENUM ('provider', 'deployer', 'importer', 'distributor');

-- CreateEnum
CREATE TYPE "AiSystemStatus" AS ENUM ('planned', 'in_use', 'retired');

-- CreateEnum
CREATE TYPE "AiRiskClass" AS ENUM ('unclassified', 'out_of_scope', 'prohibited', 'high_risk', 'limited_risk', 'minimal_risk');

-- CreateEnum
CREATE TYPE "AiObligationStatus" AS ENUM ('open', 'in_progress', 'met', 'not_applicable');

-- CreateEnum
CREATE TYPE "ModuleKey" AS ENUM ('eu_ai_act');

-- CreateTable
CREATE TABLE "AiSystem" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "intendedPurpose" TEXT NOT NULL,
    "role" "AiActRole" NOT NULL,
    "supplier" TEXT,
    "model" TEXT,
    "usesGeneralPurposeModel" BOOLEAN NOT NULL,
    "status" "AiSystemStatus" NOT NULL,
    "ownerId" UUID NOT NULL,
    "departmentId" UUID,
    "riskClass" "AiRiskClass" NOT NULL DEFAULT 'unclassified',
    "classification" JSONB,
    "classifiedAt" TIMESTAMPTZ(3),
    "classifiedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSystemObligation" (
    "aiSystemId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL,
    "status" "AiObligationStatus" NOT NULL DEFAULT 'open',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSystemObligation_pkey" PRIMARY KEY ("aiSystemId","key")
);

-- CreateTable
CREATE TABLE "AiSystemRisk" (
    "aiSystemId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSystemRisk_pkey" PRIMARY KEY ("aiSystemId","riskId")
);

-- CreateTable
CREATE TABLE "OrganisationModule" (
    "key" "ModuleKey" NOT NULL,
    "enabledAt" TIMESTAMPTZ(3) NOT NULL,
    "enabledById" UUID NOT NULL,

    CONSTRAINT "OrganisationModule_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSystem_nameKey_key" ON "AiSystem"("nameKey");

-- CreateIndex
CREATE INDEX "AiSystem_ownerId_idx" ON "AiSystem"("ownerId");

-- CreateIndex
CREATE INDEX "AiSystem_departmentId_idx" ON "AiSystem"("departmentId");

-- CreateIndex
CREATE INDEX "AiSystemRisk_riskId_idx" ON "AiSystemRisk"("riskId");

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_classifiedById_fkey" FOREIGN KEY ("classifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemObligation" ADD CONSTRAINT "AiSystemObligation_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AiSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemObligation" ADD CONSTRAINT "AiSystemObligation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemRisk" ADD CONSTRAINT "AiSystemRisk_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "AiSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemRisk" ADD CONSTRAINT "AiSystemRisk_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemRisk" ADD CONSTRAINT "AiSystemRisk_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationModule" ADD CONSTRAINT "OrganisationModule_enabledById_fkey" FOREIGN KEY ("enabledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written tail: bounds, the name key and classification consistency.
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_nameKey_check" CHECK ("nameKey" = lower(btrim("name")));
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_name_check"
  CHECK (char_length("name") BETWEEN 1 AND 200);
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_description_check"
  CHECK (char_length("description") <= 2000);
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_intendedPurpose_check"
  CHECK (char_length("intendedPurpose") BETWEEN 1 AND 2000);
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_supplier_check"
  CHECK ("supplier" IS NULL OR char_length("supplier") BETWEEN 1 AND 200);
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_model_check"
  CHECK ("model" IS NULL OR char_length("model") BETWEEN 1 AND 200);
-- Unclassified exactly when nothing about a classification is stored.
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_classification_check" CHECK (
  ("riskClass" = 'unclassified') = ("classification" IS NULL)
  AND ("classification" IS NULL) = ("classifiedAt" IS NULL)
  AND ("classification" IS NULL) = ("classifiedById" IS NULL)
);
ALTER TABLE "AiSystemObligation" ADD CONSTRAINT "AiSystemObligation_key_check"
  CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$');
ALTER TABLE "AiSystemObligation" ADD CONSTRAINT "AiSystemObligation_note_check"
  CHECK (char_length("note") <= 2000);

-- The migration owner creates tables, so isms_app needs explicit grants (default privileges may
-- already cover them; GRANT is idempotent). All four are mutable: no REVOKE.
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrganisationModule" TO isms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiSystem" TO isms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiSystemObligation" TO isms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AiSystemRisk" TO isms_app;
