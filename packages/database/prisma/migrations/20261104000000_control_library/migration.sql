-- CreateEnum
CREATE TYPE "ControlCategory" AS ENUM ('governance', 'privacy', 'suppliers', 'assets', 'access', 'people', 'physical', 'operations', 'resilience', 'incidents', 'development');

-- CreateTable
CREATE TABLE "Framework" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "Framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkVersion" (
    "id" UUID NOT NULL,
    "frameworkId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "FrameworkVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" UUID NOT NULL,
    "frameworkVersionId" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fullText" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Control" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "guidance" TEXT[],
    "category" "ControlCategory" NOT NULL,
    "libraryVersion" TEXT NOT NULL,

    CONSTRAINT "Control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlRequirementMapping" (
    "id" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlRequirementMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Framework_key_key" ON "Framework"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkVersion_key_key" ON "FrameworkVersion"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_frameworkVersionId_ref_key" ON "Requirement"("frameworkVersionId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Control_code_key" ON "Control"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ControlRequirementMapping_controlId_requirementId_key" ON "ControlRequirementMapping"("controlId", "requirementId");

-- AddForeignKey
ALTER TABLE "FrameworkVersion" ADD CONSTRAINT "FrameworkVersion_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "FrameworkVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlRequirementMapping" ADD CONSTRAINT "ControlRequirementMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlRequirementMapping" ADD CONSTRAINT "ControlRequirementMapping_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlRequirementMapping" ADD CONSTRAINT "ControlRequirementMapping_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A review records both who and when, or neither.
ALTER TABLE "ControlRequirementMapping"
  ADD CONSTRAINT "ControlRequirementMapping_review_complete"
  CHECK (("reviewedById" IS NULL) = ("reviewedAt" IS NULL));

-- New tables get full DML for isms_app from the default privileges set in the init migration,
-- so the library tables are restricted explicitly here. Library content changes only through the
-- owner-run sync; the runtime role reads it and records mapping reviews.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "Framework", "FrameworkVersion", "Requirement", "Control", "ControlRequirementMapping" FROM isms_app;
GRANT UPDATE ("reviewedById", "reviewedAt") ON "ControlRequirementMapping" TO isms_app;
