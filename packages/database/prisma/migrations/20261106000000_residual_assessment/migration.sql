-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "residualImpact" INTEGER,
ADD COLUMN     "residualLikelihood" INTEGER;


-- Plan 5: expected-after-treatment levels are 1-5 when set (as likelihood and impact).
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_residualLikelihood_check" CHECK ("residualLikelihood" IS NULL OR "residualLikelihood" BETWEEN 1 AND 5);
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_residualImpact_check" CHECK ("residualImpact" IS NULL OR "residualImpact" BETWEEN 1 AND 5);
