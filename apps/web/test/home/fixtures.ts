import type { WorkspaceResponse } from "@isms/contracts";

export const EMPTY_WORKSPACE: WorkspaceResponse = {
  statements: [],
  dimensions: null,
  riskPicture: null,
  myConcerns: [],
  myTasks: [],
};

/** A busy viewer: every number here is distinct, so a number shown must be one of these. */
export const WORKSPACE: WorkspaceResponse = {
  statements: [
    { key: "approvalsWaiting", count: 2, href: "/risks?filter=awaitingMyApproval" },
    { key: "aboveAppetite", count: 5, href: "/risks?filter=aboveAppetite" },
    { key: "evidenceMissing", count: 4, href: "/risks?filter=evidenceMissing" },
    { key: "tasksOpen", count: 3, href: "/tasks" },
    { key: "concernsUpdated", count: 1, href: "/concerns" },
  ],
  dimensions: {
    risks: {
      total: 17,
      aboveAppetite: 5,
      proposed: 6,
      inReview: 7,
      approved: 3,
      returned: 1,
      closed: 0,
    },
    controls: { accepted: 15, withEvidence: 12, testedWithinInterval: 0 },
    evidence: { items: 23, missing: 4 },
    tasks: { open: 9, overdue: 8 },
  },
  riskPicture: null,
  myConcerns: [
    {
      id: "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e",
      reference: "R-0042",
      title: "Laptop left on the train",
      state: "in_review",
      updatedAt: "2026-11-04T10:00:00.000Z",
    },
  ],
  myTasks: [
    {
      id: "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607",
      kind: "evidence_request",
      title: "Upload the restore report",
      riskReference: "R-0003",
      riskTitle: null,
      riskId: null,
      dueDate: "2026-12-01",
      overdue: false,
    },
    {
      id: "7a2b3c4d-5e6f-4a70-9b81-c2d3e4f5a6b7",
      kind: "treatment_action",
      title: "Send the access review",
      riskReference: "R-0004",
      riskTitle: "Access is never reviewed",
      riskId: null,
      dueDate: "2026-10-20",
      overdue: true,
    },
  ],
};
