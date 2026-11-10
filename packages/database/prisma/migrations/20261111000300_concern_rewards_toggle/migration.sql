-- Issue #31 begins as an explicit, installation-wide opt-in. Concern reporting itself remains on.
ALTER TABLE "Organisation"
  ADD COLUMN "concernRewardsEnabled" BOOLEAN NOT NULL DEFAULT false;
