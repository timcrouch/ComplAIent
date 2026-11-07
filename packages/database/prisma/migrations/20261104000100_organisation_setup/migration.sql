-- Plan 1 had no way to create a scoped assignment (scopeId pointed at nothing). If one exists
-- anyway it cannot be converted safely, so stop and let a person decide.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RoleAssignment" WHERE "scopeId" IS NOT NULL) THEN
    RAISE EXCEPTION 'scoped role assignments exist; migrate them manually';
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "OrganisationFrameworkStatus" AS ENUM ('suggested', 'confirmed');

-- CreateEnum
CREATE TYPE "OrganisationFrameworkSource" AS ENUM ('manual', 'ai');

-- CreateEnum
CREATE TYPE "RiskAxis" AS ENUM ('likelihood', 'impact');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('information', 'application', 'device', 'service', 'facility', 'other');

-- DropIndex
DROP INDEX "RoleAssignment_userId_role_scopeType_scopeId_key";

-- AlterTable (nameKey is backfilled before it becomes NOT NULL, so any existing row survives)
ALTER TABLE "Department" ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nameKey" TEXT;
UPDATE "Department" SET "nameKey" = lower(btrim("name"));
ALTER TABLE "Department" ALTER COLUMN "nameKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "approximateHeadcount" INTEGER,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "setupCompletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "setupCompletedById" UUID,
ADD COLUMN     "singleton" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Prisma's @updatedAt sets the value in the client, so the column keeps no default.
ALTER TABLE "Organisation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RoleAssignment" DROP CONSTRAINT "RoleAssignment_scope_check",
DROP COLUMN "scopeId",
ADD COLUMN     "departmentId" UUID,
ADD COLUMN     "siteId" UUID;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nameKey" TEXT;
UPDATE "Site" SET "nameKey" = lower(btrim("name"));
ALTER TABLE "Site" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateTable
CREATE TABLE "OrganisationFramework" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "status" "OrganisationFrameworkStatus" NOT NULL,
    "source" "OrganisationFrameworkSource" NOT NULL,
    "reasoning" TEXT,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganisationFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScale" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "appetiteThreshold" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScaleLevel" (
    "id" UUID NOT NULL,
    "riskScaleId" UUID NOT NULL,
    "axis" "RiskAxis" NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "RiskScaleLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "siteId" UUID,
    "ownerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationFramework_frameworkVersionId_key" ON "OrganisationFramework"("frameworkVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskScale_version_key" ON "RiskScale"("version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskScaleLevel_riskScaleId_axis_value_key" ON "RiskScaleLevel"("riskScaleId", "axis", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Department_nameKey_key" ON "Department"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_singleton_key" ON "Organisation"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_userId_role_scopeType_siteId_departmentId_key" ON "RoleAssignment"("userId", "role", "scopeType", "siteId", "departmentId") NULLS NOT DISTINCT;
-- NULLS NOT DISTINCT keeps organisation-scoped assignments (both ids NULL) unique; Prisma does not
-- model it, so the index name matches the generated one and `migrate diff` reports no difference.

-- CreateIndex
CREATE UNIQUE INDEX "Site_nameKey_key" ON "Site"("nameKey");

-- AddForeignKey
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_setupCompletedById_fkey" FOREIGN KEY ("setupCompletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFramework" ADD CONSTRAINT "OrganisationFramework_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "FrameworkVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationFramework" ADD CONSTRAINT "OrganisationFramework_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScale" ADD CONSTRAINT "RiskScale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScaleLevel" ADD CONSTRAINT "RiskScaleLevel_riskScaleId_fkey" FOREIGN KEY ("riskScaleId") REFERENCES "RiskScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one Organisation row: singleton is always true and unique.
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_singleton_check" CHECK ("singleton");
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_headcount_check"
  CHECK ("approximateHeadcount" IS NULL OR "approximateHeadcount" BETWEEN 1 AND 1000000);

ALTER TABLE "Site" ADD CONSTRAINT "Site_nameKey_check" CHECK ("nameKey" = lower(btrim("name")));
ALTER TABLE "Site" ADD CONSTRAINT "Site_countryCode_check" CHECK ("countryCode" ~ '^[A-Z]{2}$');
ALTER TABLE "Department" ADD CONSTRAINT "Department_nameKey_check" CHECK ("nameKey" = lower(btrim("name")));

-- The scope type decides which scope column is set.
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scope_check" CHECK (
  ("scopeType" = 'ORGANISATION' AND "siteId" IS NULL AND "departmentId" IS NULL)
  OR ("scopeType" = 'SITE' AND "siteId" IS NOT NULL AND "departmentId" IS NULL)
  OR ("scopeType" = 'DEPARTMENT' AND "departmentId" IS NOT NULL AND "siteId" IS NULL)
);

ALTER TABLE "OrganisationFramework" ADD CONSTRAINT "OrganisationFramework_confirmed_check"
  CHECK (("status" = 'confirmed') = ("confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL));

ALTER TABLE "RiskScale" ADD CONSTRAINT "RiskScale_appetiteThreshold_check"
  CHECK ("appetiteThreshold" BETWEEN 1 AND 24);
ALTER TABLE "RiskScaleLevel" ADD CONSTRAINT "RiskScaleLevel_value_check" CHECK ("value" BETWEEN 1 AND 5);

-- Risk scale versions are append-only: a change is a new version. (New tables got full DML from the
-- default privileges set in the init migration.)
REVOKE UPDATE, DELETE, TRUNCATE ON "RiskScale", "RiskScaleLevel" FROM isms_app;
