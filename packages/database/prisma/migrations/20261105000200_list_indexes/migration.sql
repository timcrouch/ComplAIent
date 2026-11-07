-- Plan 3 final review M-6: indexes for foreign-key columns and the list and count queries of
-- the risk slice. Additive only; the tables are new, so the indexes build on empty tables.
-- Approval(riskId) is already served by the unique (riskId, version, decision) index.

-- The evidence-missing count looks up EvidenceControl by control alone.
CREATE INDEX "EvidenceControl_controlId_idx" ON "EvidenceControl"("controlId");

-- Per-risk lookups of evidence, tasks (and open requests per control) and conversations.
CREATE INDEX "Evidence_riskId_idx" ON "Evidence"("riskId");
CREATE INDEX "Task_riskId_controlId_idx" ON "Task"("riskId", "controlId");
CREATE INDEX "ConcernConversation_reporterId_idx" ON "ConcernConversation"("reporterId");

-- Visibility and list filters on the risk register, and its keyset order.
CREATE INDEX "Risk_siteId_idx" ON "Risk"("siteId");
CREATE INDEX "Risk_departmentId_idx" ON "Risk"("departmentId");
CREATE INDEX "Risk_updatedAt_id_idx" ON "Risk"("updatedAt", "id");
