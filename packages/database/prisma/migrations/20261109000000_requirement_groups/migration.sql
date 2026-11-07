-- Issue #19: requirement groups (NIST CSF Functions and Categories, ISO Annex A themes), so the
-- Statement of Applicability can be read by group. Flat frameworks keep "groupId" NULL.

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "groupId" UUID;

-- CreateTable
CREATE TABLE "RequirementGroup" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "RequirementGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementGroup_frameworkVersionId_key_key" ON "RequirementGroup"("frameworkVersionId", "key");

-- AddForeignKey
ALTER TABLE "RequirementGroup" ADD CONSTRAINT "RequirementGroup_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "FrameworkVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementGroup" ADD CONSTRAINT "RequirementGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RequirementGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RequirementGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New tables get full DML for isms_app from the default privileges set in the init migration,
-- so the library table is restricted explicitly here, as in the control_library migration.
-- Groups change only through the owner-run sync; the runtime role reads them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "RequirementGroup" FROM isms_app;
