import type { AssetType, Prisma, Role } from "@isms/database";
import type { Treatment } from "@isms/domain";
import type { RiskRow } from "./snapshot.js";

export type RoleName = Role;

export type SampleScope =
  | { kind: "organisation" }
  | { kind: "site"; site: string }
  | { kind: "department"; department: string };

export type SamplePerson = {
  key: string;
  email: string;
  displayName: string;
  /** One of the six dev sign-in users; the others never sign in. */
  signsIn: boolean;
  roles: { role: RoleName; scope: SampleScope }[];
};

export type AssetRef = { name: string; type: AssetType };

/** What an edit changes, as the API's RiskChanges; `owner` is a person key. */
export type RiskChanges = {
  likelihood?: number;
  impact?: number;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
  treatment?: Treatment;
  treatmentNote?: string;
  owner?: string;
  toConfirm?: string[];
  existingSafeguards?: string;
};

type At = { at: Date; by: string };
type OnRisk = At & { risk: string };

/**
 * One thing a person did, in the API's terms. `risk`, `action`, `request`, `evidence` and
 * `test` are keys within the plan; `by` and `assignee` are person keys; `control` is a code.
 */
export type SampleEvent =
  | (OnRisk & {
      kind: "report";
      title: string;
      scenario: string;
      threat: string;
      consequence: string;
      existingSafeguards: string;
      toConfirm: string[];
      site: string | null;
      department: string | null;
      assets: AssetRef[];
    })
  | (OnRisk & { kind: "edit"; changes: RiskChanges })
  /** An edit to treatment "accept", which clears the expected score (risk-edit.service). */
  | (OnRisk & { kind: "accept"; note: string })
  | (OnRisk & { kind: "submit" })
  | (OnRisk & { kind: "return"; concern: string })
  | (OnRisk & { kind: "approve"; comment: string })
  | (OnRisk & { kind: "close"; note: string })
  | (OnRisk & { kind: "reassess"; reason: string })
  | (OnRisk & { kind: "review"; note: string })
  | (OnRisk & { kind: "control_accept"; control: string; reason: string })
  | (OnRisk & {
      kind: "action_open";
      action: string;
      title: string;
      description: string;
      assignee: string;
      due: string;
      control: string | null;
    })
  | (OnRisk & { kind: "action_done"; action: string; due: string; note: string })
  | (OnRisk & {
      kind: "evidence_request";
      request: string;
      control: string;
      assignee: string;
      title: string;
      description: string;
      due: string | null;
    })
  | (OnRisk & {
      kind: "evidence";
      evidence: string;
      fileName: string;
      mimeType: "text/plain" | "text/csv";
      classification: "internal" | "confidential" | "restricted";
      body: string;
      controls: string[];
      /** The evidence request this upload completes, by its assignee. */
      request: string | null;
    })
  | (At & {
      kind: "control_test";
      test: string;
      control: string;
      testedOn: string;
      result: "effective" | "partially_effective" | "ineffective";
      method: string;
      notes: string;
      evidence: string[];
    })
  | (At & {
      kind: "soa";
      framework: string;
      ref: string;
      applicable: boolean;
      justification: string;
    })
  | (At & {
      kind: "narrative";
      periodKey: string;
      periodStart: string;
      periodEnd: string;
      text: string;
    });

export type SampleKind = SampleEvent["kind"];

export type SamplePlan = { people: SamplePerson[]; events: SampleEvent[] };

/** Ids of the synced control library, read from the database after the sync. */
export type LibraryIds = {
  /** By framework version key ("iso27001-2022"). */
  frameworkVersions: Record<string, string>;
  /** By control code ("ACC-01"). */
  controls: Record<string, string>;
  /** By "<framework version key> <ref>" ("iso27001-2022 A.5.1"). */
  requirements: Record<string, string>;
};

/** The person loading the sample, as their sign-in names them. */
export type LoaderIdentity = {
  email: string;
  idpIssuer: string;
  idpSubject: string;
  displayName?: string;
};

export type RowsContext = {
  now: Date;
  library: LibraryIds;
  loader: LoaderIdentity | null;
  bootstrapEmail: string | null;
};

type Rows<T> = (T & { id: string })[];

/** Rows per table, ready for createMany, with ids and every time set. */
export type SampleRows = {
  users: Rows<Prisma.UserCreateManyInput>;
  organisation: Rows<Prisma.OrganisationCreateManyInput & { createdAt: Date; updatedAt: Date }>;
  sites: Rows<Prisma.SiteCreateManyInput>;
  departments: Rows<Prisma.DepartmentCreateManyInput>;
  organisationFrameworks: Rows<Prisma.OrganisationFrameworkCreateManyInput>;
  riskScales: Rows<Prisma.RiskScaleCreateManyInput>;
  riskScaleLevels: Rows<Prisma.RiskScaleLevelCreateManyInput>;
  roleAssignments: Rows<Prisma.RoleAssignmentCreateManyInput>;
  assets: Rows<Prisma.AssetCreateManyInput>;
  risks: RiskRow[];
  riskVersions: Rows<
    Prisma.RiskVersionCreateManyInput & {
      snapshot: Prisma.InputJsonObject;
      createdAt: Date;
      changedFields: string[];
    }
  >;
  riskAssets: Prisma.RiskAssetCreateManyInput[];
  riskControls: Rows<Prisma.RiskControlCreateManyInput>;
  approvals: Rows<Prisma.ApprovalCreateManyInput & { createdAt: Date }>;
  tasks: Rows<
    Prisma.TaskCreateManyInput & { createdAt: Date; updatedAt: Date; dueDate: Date | null }
  >;
  evidence: Rows<
    Prisma.EvidenceCreateManyInput & { objectKey: string; sha256: string; sizeBytes: number }
  >;
  evidenceControls: Prisma.EvidenceControlCreateManyInput[];
  controlTests: Rows<Prisma.ControlTestCreateManyInput>;
  controlTestEvidence: Prisma.ControlTestEvidenceCreateManyInput[];
  requirementApplicability: Prisma.RequirementApplicabilityCreateManyInput[];
  boardNarratives: Rows<Prisma.BoardNarrativeCreateManyInput>;
  /** The EU AI Act module (#16): switched on, its register, obligations and risk links. */
  organisationModules: (Prisma.OrganisationModuleCreateManyInput & { enabledAt: Date })[];
  aiSystems: Rows<
    Prisma.AiSystemCreateManyInput & {
      classification: Prisma.InputJsonObject;
      classifiedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >;
  aiSystemObligations: (Prisma.AiSystemObligationCreateManyInput & {
    createdAt: Date;
    updatedAt: Date;
  })[];
  aiSystemRisks: (Prisma.AiSystemRiskCreateManyInput & { linkedAt: Date })[];
  auditEvents: Rows<Prisma.AuditEventCreateManyInput & { occurredAt: Date }>;
  /** The evidence files to put in object storage after the rows commit. */
  evidenceObjects: { key: string; body: Uint8Array; contentType: string }[];
};
