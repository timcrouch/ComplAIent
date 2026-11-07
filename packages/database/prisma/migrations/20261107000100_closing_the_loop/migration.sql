-- CreateEnum
CREATE TYPE "ControlTestResult" AS ENUM ('effective', 'partially_effective', 'ineffective');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "reviewIntervalMonths" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "closedById" UUID,
ADD COLUMN     "nextReviewDue" DATE;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "cancelledReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "completedById" UUID,
ADD COLUMN     "completionNote" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ControlTest" (
    "id" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "testedOn" DATE NOT NULL,
    "result" "ControlTestResult" NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "testedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlTestEvidence" (
    "controlTestId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "ControlTestEvidence_pkey" PRIMARY KEY ("controlTestId","evidenceId")
);

-- CreateIndex
CREATE INDEX "ControlTest_controlId_testedOn_idx" ON "ControlTest"("controlId", "testedOn");

-- CreateIndex
CREATE INDEX "ControlTestEvidence_evidenceId_idx" ON "ControlTestEvidence"("evidenceId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTest" ADD CONSTRAINT "ControlTest_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTest" ADD CONSTRAINT "ControlTest_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTestEvidence" ADD CONSTRAINT "ControlTestEvidence_controlTestId_fkey" FOREIGN KEY ("controlTestId") REFERENCES "ControlTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlTestEvidence" ADD CONSTRAINT "ControlTestEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Plan 6 (closing the loop): constraints, append-only grants and the one-open-review rule.
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_reviewIntervalMonths_check" CHECK ("reviewIntervalMonths" BETWEEN 1 AND 36);
ALTER TABLE "ControlTest" ADD CONSTRAINT "ControlTest_method_check" CHECK (length("method") BETWEEN 1 AND 4000);

-- Control tests are an audit record: the app role may INSERT and SELECT only.
REVOKE UPDATE, DELETE, TRUNCATE ON "ControlTest", "ControlTestEvidence" FROM isms_app;

-- At most one open periodic review per risk.
CREATE UNIQUE INDEX "Task_one_open_periodic_review" ON "Task"("riskId") WHERE kind = 'periodic_review' AND status = 'open';
