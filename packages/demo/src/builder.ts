import type { Prisma } from "@isms/database";
import { rng } from "./random.js";
import type { LibraryIds, SampleRows } from "./types.js";
import { uuidv7At } from "./uuid7.js";

/** Plain JSON for an audit snapshot, as `AuditService` stores it. */
export type Json = Prisma.InputJsonValue;

export const emptyRows = (): SampleRows => ({
  users: [],
  organisation: [],
  sites: [],
  departments: [],
  organisationFrameworks: [],
  riskScales: [],
  riskScaleLevels: [],
  roleAssignments: [],
  assets: [],
  risks: [],
  riskVersions: [],
  riskAssets: [],
  riskControls: [],
  approvals: [],
  tasks: [],
  evidence: [],
  evidenceControls: [],
  controlTests: [],
  controlTestEvidence: [],
  requirementApplicability: [],
  boardNarratives: [],
  auditEvents: [],
  evidenceObjects: [],
});

/**
 * UUIDv7 ids for backdated rows. Ids made for the same millisecond carry a rising counter, so
 * rows written in order within one action also sort in that order, as the API's would.
 */
export function idMaker(seed: number): (at: Date) => string {
  const rand = rng(seed);
  let lastMs = -1;
  let seq = 0;
  return (at) => {
    const ms = at.getTime();
    seq = ms === lastMs ? seq + 1 : 0;
    lastMs = ms;
    return uuidv7At(at, rand, seq);
  };
}

/** Writes rows into `rows` with ids from `id`; one per run of the generator (or its extras). */
export class Builder {
  /** The request id of the action being written; every audit row of one action shares it. */
  requestId = "sample:00000";

  constructor(
    readonly rows: SampleRows,
    readonly id: (at: Date) => string,
    readonly library: LibraryIds,
    private readonly users: Map<string, string>,
  ) {}

  /** The user id of a person key (or of an extra user added by email). */
  user(key: string): string {
    const id = this.users.get(key);
    if (id === undefined) throw new Error(`no user for ${key}`);
    return id;
  }

  addUser(key: string, id: string): void {
    this.users.set(key, id);
  }

  control(code: string): string {
    const id = this.library.controls[code];
    if (id === undefined) throw new Error(`control ${code} is not in the library`);
    return id;
  }

  requirement(framework: string, ref: string): string {
    const id = this.library.requirements[`${framework} ${ref}`];
    if (id === undefined) throw new Error(`requirement ${framework} ${ref} is not in the library`);
    return id;
  }

  frameworkVersion(key: string): string {
    const id = this.library.frameworkVersions[key];
    if (id === undefined) throw new Error(`framework version ${key} is not in the library`);
    return id;
  }

  /** One audit row, as `AuditService.record` writes it: absent snapshots stay NULL. */
  audit(
    at: Date,
    actorUserId: string,
    action: string,
    objectType: string,
    objectId: string,
    after?: Record<string, Json | null>,
    before?: Record<string, Json | null>,
  ): void {
    this.rows.auditEvents.push({
      id: this.id(at),
      occurredAt: at,
      actorUserId,
      action,
      objectType,
      objectId,
      ...(before === undefined ? {} : { beforeRef: before }),
      ...(after === undefined ? {} : { afterRef: after }),
      requestId: this.requestId,
      traceId: null,
    });
  }
}

/** Free text in the audit trail: its length only (risk-edit-audit, approval, lifecycle). */
export const lengthOf = (text: string) => ({ length: text.length });
