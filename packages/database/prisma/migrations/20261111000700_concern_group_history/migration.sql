-- Historical evaluation versions may retain the same former group position. Current-position
-- uniqueness is enforced under the evaluation transaction lock instead of across history.
DROP INDEX "ConcernEvaluation_duplicateGroupId_duplicatePosition_key";
