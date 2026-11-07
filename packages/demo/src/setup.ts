import type { Role, ScopeType } from "@isms/database";
import {
  SAMPLE_APPETITE_THRESHOLD,
  SAMPLE_DEPARTMENTS,
  SAMPLE_FRAMEWORKS,
  SAMPLE_ORGANISATION,
  SAMPLE_SCALE_LEVELS,
  SAMPLE_SITES,
} from "./company.js";
import type { Builder } from "./builder.js";
import { MINUTE } from "./time.js";
import type { LoaderIdentity, SamplePerson, SampleRows, SampleScope } from "./types.js";

/** Placeholder users: the issuer marks the subject as pending until a sign-in claims it (P9-R3). */
export const PENDING_ISSUER = "pending:";

const normalise = (email: string) => email.trim().toLowerCase();
const SCOPE_TYPE: Record<SampleScope["kind"], ScopeType> = {
  organisation: "ORGANISATION",
  site: "SITE",
  department: "DEPARTMENT",
};

/** The users, written as placeholders. Each person's key maps to their id in the builder. */
export function writePeople(b: Builder, people: readonly SamplePerson[], at: Date): void {
  for (const p of people) {
    const id = b.id(at);
    b.addUser(p.key, id);
    b.rows.users.push({
      id,
      idpIssuer: PENDING_ISSUER,
      idpSubject: p.email,
      email: p.email,
      displayName: p.displayName,
    });
  }
}

/** One role assignment and its `identity.role_granted` row (role-assignment.service). */
function grant(
  b: Builder,
  at: Date,
  userId: string,
  role: Role,
  scope: SampleScope,
  by: string,
): void {
  const siteId = scope.kind === "site" ? siteIdOf(b, scope.site) : null;
  const departmentId = scope.kind === "department" ? departmentIdOf(b, scope.department) : null;
  const id = b.id(at);
  b.rows.roleAssignments.push({
    id,
    userId,
    role,
    scopeType: SCOPE_TYPE[scope.kind],
    siteId,
    departmentId,
    grantedById: by,
    createdAt: at,
  });
  b.audit(at, by, "identity.role_granted", "RoleAssignment", id, {
    userId,
    role,
    scopeType: scope.kind,
    scopeId: siteId ?? departmentId,
  });
}

const siteIdOf = (b: Builder, key: string) => {
  const i = SAMPLE_SITES.findIndex((s) => s.key === key);
  const row = b.rows.sites[i];
  if (!row) throw new Error(`unknown site ${key}`);
  return row.id;
};
const departmentIdOf = (b: Builder, key: string) => {
  const i = SAMPLE_DEPARTMENTS.findIndex((d) => d.key === key);
  const row = b.rows.departments[i];
  if (!row) throw new Error(`unknown department ${key}`);
  return row.id;
};

export const siteId = siteIdOf;
export const departmentId = departmentIdOf;

/**
 * Setup as Anna Admin does it on the first day, in the API's order and with its audit rows:
 * bootstrap administrator, profile, sites, departments, frameworks, risk scale, completion,
 * then everyone's roles. Returns the risk scale id.
 */
export function writeSetup(b: Builder, people: readonly SamplePerson[], start: number): string {
  let t = start;
  const tick = () => {
    t += MINUTE;
    b.requestId = `sample:setup-${String((t - start) / MINUTE)}`;
    return new Date(t);
  };
  const anna = b.user("anna");
  let at = tick();
  b.rows.roleAssignments.push({
    id: b.id(at),
    userId: anna,
    role: "administrator",
    scopeType: "ORGANISATION",
    siteId: null,
    departmentId: null,
    grantedById: anna,
    createdAt: at,
  });
  b.audit(at, anna, "identity.bootstrap_admin", "User", anna, {
    role: "administrator",
    scope: "organisation",
  });

  at = tick();
  const { reviewIntervalMonths, ...profile } = SAMPLE_ORGANISATION;
  const orgId = b.id(at);
  const org: SampleRows["organisation"][number] = {
    id: orgId,
    singleton: true,
    ...profile,
    reviewIntervalMonths,
    setupCompletedAt: null,
    setupCompletedById: null,
    createdAt: at,
    updatedAt: at,
  };
  b.rows.organisation.push(org);
  b.audit(at, anna, "organisation.profile_updated", "Organisation", orgId, { ...profile });

  at = tick();
  for (const s of SAMPLE_SITES) {
    const id = b.id(at);
    b.rows.sites.push({
      id,
      name: s.name,
      nameKey: s.name.toLowerCase(),
      countryCode: s.countryCode,
      createdAt: at,
    });
    b.audit(at, anna, "organisation.site_added", "Site", id, {
      name: s.name,
      countryCode: s.countryCode,
    });
  }
  at = tick();
  for (const d of SAMPLE_DEPARTMENTS) {
    const id = b.id(at);
    b.rows.departments.push({ id, name: d.name, nameKey: d.name.toLowerCase(), createdAt: at });
    b.audit(at, anna, "organisation.department_added", "Department", id, { name: d.name });
  }
  at = tick();
  for (const key of SAMPLE_FRAMEWORKS) {
    const id = b.id(at);
    b.rows.organisationFrameworks.push({
      id,
      frameworkVersionId: b.frameworkVersion(key),
      status: "confirmed",
      source: "manual",
      reasoning: null,
      confirmedById: anna,
      confirmedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    b.audit(at, anna, "organisation.framework_confirmed", "OrganisationFramework", id, {
      frameworkVersionKey: key,
      status: "confirmed",
      source: "manual",
    });
  }
  at = tick();
  const scaleId = b.id(at);
  b.rows.riskScales.push({
    id: scaleId,
    version: 1,
    appetiteThreshold: SAMPLE_APPETITE_THRESHOLD,
    createdById: anna,
    createdAt: at,
  });
  for (const axis of ["likelihood", "impact"] as const)
    for (const level of SAMPLE_SCALE_LEVELS[axis])
      b.rows.riskScaleLevels.push({ id: b.id(at), riskScaleId: scaleId, axis, ...level });
  b.audit(at, anna, "organisation.risk_scale_created", "RiskScale", scaleId, {
    version: 1,
    appetiteThreshold: SAMPLE_APPETITE_THRESHOLD,
  });

  at = tick();
  org.setupCompletedAt = at;
  org.setupCompletedById = anna;
  b.audit(at, anna, "organisation.setup_completed", "Organisation", orgId, {
    setupCompletedAt: at.toISOString(),
  });

  for (const p of people)
    for (const r of p.roles) {
      if (p.key === "anna" && r.role === "administrator") continue;
      grant(b, tick(), b.user(p.key), r.role, r.scope, anna);
    }
  return scaleId;
}

const ORG: SampleScope = { kind: "organisation" };

/**
 * P9-R3, with ids from a separate maker so nothing else changes with who loads:
 * - the loader gets their exact issuer, subject and email, and administrator: on their sample
 *   person's row when the email is a sample person's, otherwise on a new row;
 * - the bootstrap email, when it is not the loader's, gets administrator, on a new placeholder
 *   row when it is no sample person's.
 */
export function writeIdentities(
  b: Builder,
  people: readonly SamplePerson[],
  loader: LoaderIdentity | null,
  bootstrapEmail: string | null,
  at: Date,
): void {
  const anna = b.user("anna");
  const isAdmin = (userId: string) =>
    b.rows.roleAssignments.some(
      (a) => a.userId === userId && a.role === "administrator" && a.scopeType === "ORGANISATION",
    );
  const ensureAdmin = (userId: string) => {
    if (!isAdmin(userId)) grant(b, at, userId, "administrator", ORG, anna);
  };
  const sampleUser = (email: string) => {
    const p = people.find((x) => normalise(x.email) === normalise(email));
    return p ? b.rows.users.find((u) => u.id === b.user(p.key)) : undefined;
  };
  b.requestId = "sample:identities";
  if (loader) {
    const row = sampleUser(loader.email);
    if (row) {
      row.idpIssuer = loader.idpIssuer;
      row.idpSubject = loader.idpSubject;
      row.email = loader.email;
      ensureAdmin(row.id);
    } else {
      const id = b.id(at);
      b.rows.users.push({
        id,
        idpIssuer: loader.idpIssuer,
        idpSubject: loader.idpSubject,
        email: loader.email,
        displayName: loader.displayName ?? loader.email,
      });
      ensureAdmin(id);
    }
  }
  const boot = bootstrapEmail?.trim() ?? "";
  if (boot === "" || (loader && normalise(loader.email) === normalise(boot))) return;
  const row = sampleUser(boot);
  if (row) {
    ensureAdmin(row.id);
    return;
  }
  const id = b.id(at);
  b.rows.users.push({
    id,
    idpIssuer: PENDING_ISSUER,
    idpSubject: boot,
    email: boot,
    displayName: boot,
  });
  ensureAdmin(id);
}
