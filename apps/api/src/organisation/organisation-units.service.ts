import { Inject, Injectable } from "@nestjs/common";
import {
  type ConflictReason,
  type DepartmentDto,
  type DepartmentInput,
  type SiteDto,
  type SiteInput,
  type UnitsInput,
  type UnitsResponse,
  conflictDetail,
} from "@isms/contracts";
import { Prisma } from "@isms/database";
import { DomainError, type ErrorDetail } from "@isms/domain";
import { type AuditContext, AuditService, type AuditSnapshot } from "../audit/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { withSetupLock } from "./setup-lock.js";
import { type UnitDiff, diffUnits } from "./unit-diff.js";

type Tx = Prisma.TransactionClient;
type Stored = { id: string; name: string; nameKey: string };
type Keyed = { name: string; nameKey: string };

/** How one kind of unit (site or department) is read, written and audited. */
type UnitKind<S extends Stored, I extends { id?: string | undefined; name: string }> = {
  field: "sites" | "departments";
  /** Audit action stem and object type: `organisation.<stem>_added`, objectType `<Type>`. */
  stem: "site" | "department";
  objectType: "Site" | "Department";
  inUse: ConflictReason;
  same: (stored: S, input: I) => boolean;
  snapshot: (unit: S | I) => AuditSnapshot;
  findAll: (tx: Tx) => Promise<S[]>;
  create: (tx: Tx, input: I & Keyed) => Promise<S>;
  /** `values` is the input, or a placeholder name during a rename. */
  update: (tx: Tx, id: string, values: Partial<I> & Keyed) => Promise<S>;
  remove: (tx: Tx, id: string) => Promise<void>;
};

const ORDER = [{ nameKey: "asc" }, { id: "asc" }] as const;
const SITE = { id: true, name: true, nameKey: true, countryCode: true } as const;
const DEPARTMENT = { id: true, name: true, nameKey: true } as const;
type StoredSite = Prisma.SiteGetPayload<{ select: typeof SITE }>;
type StoredDepartment = Prisma.DepartmentGetPayload<{ select: typeof DEPARTMENT }>;

const SITES: UnitKind<StoredSite, SiteInput> = {
  field: "sites",
  stem: "site",
  objectType: "Site",
  inUse: "siteInUse",
  same: (s, i) => s.name === i.name && s.countryCode === i.countryCode,
  snapshot: (u) => ({ name: u.name, countryCode: u.countryCode }),
  findAll: (tx) => tx.site.findMany({ orderBy: [...ORDER], select: SITE }),
  create: (tx, i) =>
    tx.site.create({
      data: { name: i.name, nameKey: i.nameKey, countryCode: i.countryCode },
      select: SITE,
    }),
  update: (tx, id, v) =>
    tx.site.update({
      where: { id },
      data: {
        name: v.name,
        nameKey: v.nameKey,
        ...(v.countryCode === undefined ? {} : { countryCode: v.countryCode }),
      },
      select: SITE,
    }),
  remove: async (tx, id) => {
    await tx.site.delete({ where: { id }, select: { id: true } });
  },
};

const DEPARTMENTS: UnitKind<StoredDepartment, DepartmentInput> = {
  field: "departments",
  stem: "department",
  objectType: "Department",
  inUse: "departmentInUse",
  same: (s, i) => s.name === i.name,
  snapshot: (u) => ({ name: u.name }),
  findAll: (tx) => tx.department.findMany({ orderBy: [...ORDER], select: DEPARTMENT }),
  create: (tx, i) =>
    tx.department.create({ data: { name: i.name, nameKey: i.nameKey }, select: DEPARTMENT }),
  update: (tx, id, v) =>
    tx.department.update({
      where: { id },
      data: { name: v.name, nameKey: v.nameKey },
      select: DEPARTMENT,
    }),
  remove: async (tx, id) => {
    await tx.department.delete({ where: { id }, select: { id: true } });
  },
};

const toSiteDto = (s: StoredSite): SiteDto => ({
  id: s.id,
  name: s.name,
  countryCode: s.countryCode,
});
const toDepartmentDto = (d: StoredDepartment): DepartmentDto => ({ id: d.id, name: d.name });

const isForeignKeyViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";

/**
 * Name keys exactly as the database's check constraint derives them, `lower(btrim(name))`,
 * so the stored key can never disagree with the constraint, whatever the locale.
 */
async function nameKeys(tx: Tx, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const rows = await tx.$queryRaw<{ key: string }[]>`
    SELECT lower(btrim(t.name)) AS key
    FROM unnest(${[...names]}::text[]) WITH ORDINALITY AS t(name, i)
    ORDER BY t.i`;
  return rows.map((r) => r.key);
}

/** A planned replacement of one kind of unit, validated before anything is written. */
type Plan<S extends Stored, I extends { id?: string | undefined; name: string }> = {
  kind: UnitKind<S, I>;
  diff: UnitDiff<S, I>;
  keys: Map<I, string>;
};

async function plan<S extends Stored, I extends { id?: string | undefined; name: string }>(
  tx: Tx,
  kind: UnitKind<S, I>,
  input: readonly I[],
  invalid: ErrorDetail[],
): Promise<Plan<S, I>> {
  const diff = diffUnits(kind.field, await kind.findAll(tx), input, kind.same);
  invalid.push(...diff.invalid);
  const keys = await nameKeys(
    tx,
    input.map((i) => i.name),
  );
  // The contract compares with JavaScript's toLowerCase; the database's lower() decides.
  const seen = new Set<string>();
  const byInput = new Map<I, string>();
  input.forEach((entry, i) => {
    const key = keys[i] ?? "";
    if (seen.has(key)) {
      invalid.push({ path: `${kind.field}.${String(i)}.name`, message: "Duplicate name" });
    }
    seen.add(key);
    byInput.set(entry, key);
  });
  return { kind, diff, keys: byInput };
}

/**
 * Applies a plan: removals first (freeing their names), then renames, then additions. A
 * rename that changes the name key first parks the unit under its own id, so names can be
 * swapped within one save without tripping the unique index. One audit row per change.
 */
async function apply<S extends Stored, I extends { id?: string | undefined; name: string }>(
  tx: Tx,
  { kind, diff, keys }: Plan<S, I>,
  audit: AuditService,
  ctx: AuditContext,
): Promise<void> {
  const record = (verb: "added" | "updated" | "removed", id: string, before?: S, after?: S) =>
    audit.record(
      {
        action: `organisation.${kind.stem}_${verb}`,
        objectType: kind.objectType,
        objectId: id,
        ...(before ? { before: kind.snapshot(before) } : {}),
        ...(after ? { after: kind.snapshot(after) } : {}),
      },
      ctx,
      tx,
    );

  for (const unit of diff.remove) {
    try {
      await kind.remove(tx, unit.id);
    } catch (err) {
      if (!isForeignKeyViolation(err)) throw err;
      throw new DomainError("CONFLICT", "A unit that is still in use cannot be removed", [
        conflictDetail(kind.inUse, unit.id),
      ]);
    }
    await record("removed", unit.id, unit);
  }

  const keyOf = (entry: I): string => keys.get(entry) ?? "";
  for (const { stored, input } of diff.update) {
    if (keyOf(input) === stored.nameKey) continue;
    // A tab before the unit's own id: unique, a name the contract never accepts (so no
    // stored unit can hold it), and its own key under lower(btrim()), which keeps tabs.
    const placeholder = `\t${stored.id}`;
    const parked = { name: placeholder, nameKey: placeholder } as Partial<I> & Keyed;
    await kind.update(tx, stored.id, parked);
  }
  for (const { stored, input } of diff.update) {
    const updated = await kind.update(tx, stored.id, { ...input, nameKey: keyOf(input) });
    await record("updated", stored.id, stored, updated);
  }

  for (const entry of diff.create) {
    const created = await kind.create(tx, { ...entry, nameKey: keyOf(entry) });
    await record("added", created.id, undefined, created);
  }
}

/**
 * Sites and departments, replaced together in one save (PF4): one setup lock, one
 * transaction, all or nothing. A unit still referenced (for example by a role assignment)
 * cannot be removed: 409 `siteInUse.<id>` or `departmentInUse.<id>`, and nothing changes.
 */
@Injectable()
export class OrganisationUnitsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Sites and departments, each sorted by name ignoring case. */
  async list(db: Tx = this.prisma): Promise<UnitsResponse> {
    const sites = await SITES.findAll(db);
    const departments = await DEPARTMENTS.findAll(db);
    return { sites: sites.map(toSiteDto), departments: departments.map(toDepartmentDto) };
  }

  replace(input: UnitsInput, ctx: AuditContext): Promise<UnitsResponse> {
    return withSetupLock(this.prisma, async (tx) => {
      const invalid: ErrorDetail[] = [];
      const sites = await plan(tx, SITES, input.sites, invalid);
      const departments = await plan(tx, DEPARTMENTS, input.departments, invalid);
      if (invalid.length > 0) {
        throw new DomainError("VALIDATION_FAILED", "Request validation failed", invalid);
      }
      await apply(tx, sites, this.audit, ctx);
      await apply(tx, departments, this.audit, ctx);
      return this.list(tx);
    });
  }
}
