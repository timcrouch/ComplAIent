import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { assertTestDatabaseUrl, resetTestDatabase } from "@isms/database/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_LOCK,
  DemoPortsError,
  loadLibraryIds,
  loadSample,
  planSampleYear,
  resetInstance,
  rowsFor,
  type DemoActor,
  type DemoPorts,
} from "../src/index.js";

const url = loadConfig(databaseTestConfig).DATABASE_OWNER_TEST_URL;
assertTestDatabaseUrl(url);
const db = createPrismaClient(url);

const CLI: DemoActor = { email: "cli@example.test", cli: true };
const LOADER: DemoActor = {
  email: "loader@corp.example",
  idpIssuer: "https://idp.test/realms/x",
  idpSubject: "sub-loader-1",
};
const LIBRARY_TABLES = new Set([
  "Framework",
  "FrameworkVersion",
  "RequirementGroup",
  "Requirement",
  "Control",
  "ControlRequirementMapping",
]);

/** `fail` names steps that reject (after being recorded); `failEvidence` fails the first puts. */
function fakePorts(opts: { failEvidence?: number; fail?: readonly (keyof DemoPorts)[] } = {}) {
  const calls: string[] = [];
  let puts = 0;
  const step =
    <T>(name: keyof DemoPorts, value: T) =>
    () => {
      calls.push(name);
      return opts.fail?.includes(name)
        ? Promise.reject(new Error(`${name} down`))
        : Promise.resolve(value);
    };
  const ports: DemoPorts = {
    wipeEvidence: step("wipeEvidence", 0),
    putEvidence: () => {
      puts += 1;
      if (opts.failEvidence !== undefined && puts <= opts.failEvidence)
        return Promise.reject(new Error("s3 down"));
      calls.push("putEvidence");
      return Promise.resolve();
    },
    wipeSessions: step("wipeSessions", 0),
    drainQueues: step("drainQueues", undefined),
    enqueueLibraryEmbed: step("enqueueLibraryEmbed", undefined),
  };
  return { ports, calls };
}

async function counts(): Promise<Record<string, number>> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const out: Record<string, number> = {};
  for (const { tablename } of tables) {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${tablename}"`,
    );
    out[tablename] = Number(rows[0]?.n ?? 0);
  }
  return out;
}

const NOW = new Date();

beforeEach(async () => {
  await resetTestDatabase();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("resetInstance", () => {
  it("empties every table but the library and leaves demo.reset as the only audit row", async () => {
    const { ports } = fakePorts();
    await loadSample(db, ports, CLI, { now: NOW, bootstrapEmail: null });
    const { ports: p2, calls } = fakePorts();
    await resetInstance(db, p2, LOADER);

    const after = await counts();
    for (const [table, n] of Object.entries(after)) {
      if (LIBRARY_TABLES.has(table)) expect(n, table).toBeGreaterThan(0);
      else if (table === "AuditEvent") expect(n).toBe(1);
      else expect(n, table).toBe(0);
    }
    const audit = await db.auditEvent.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "demo.reset",
      actorUserId: null,
      afterRef: { actorEmail: LOADER.email },
    });
    const migrations = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM "_prisma_migrations"`;
    expect(Number(migrations[0]?.n)).toBeGreaterThan(0);
    // Stale jobs are drained first (#7), before anything else touches the fresh state.
    expect(calls).toEqual(["drainQueues", "wipeEvidence", "wipeSessions", "enqueueLibraryEmbed"]);
  });

  it("restarts the Risk reference sequence", async () => {
    await loadSample(db, fakePorts().ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    await resetInstance(db, fakePorts().ports, CLI);
    const seq = await db.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
      SELECT last_value, is_called FROM "Risk_reference_seq"`;
    expect(seq[0]).toMatchObject({ last_value: 1n, is_called: false });
  });
});

describe("loadSample", () => {
  it("is repeatable: the same counts, references and titles on a second load", async () => {
    const opts = { now: NOW, bootstrapEmail: "admin@example.test" };
    const first = await loadSample(db, fakePorts().ports, CLI, opts);
    const c1 = await counts();
    const risks1 = await db.risk.findMany({
      orderBy: { reference: "asc" },
      select: { reference: true, title: true },
    });
    const second = await loadSample(db, fakePorts().ports, CLI, opts);
    expect(await counts()).toEqual(c1);
    expect(
      await db.risk.findMany({
        orderBy: { reference: "asc" },
        select: { reference: true, title: true },
      }),
    ).toEqual(risks1);
    expect(first.risks).toBe(second.risks);
    expect(first.risks).toBe(risks1.length);
    expect(first.people).toBe(c1["User"]);
    // The audit trail restarts too: reset, then the sample, then loaded; never two resets.
    expect(await db.auditEvent.count({ where: { action: "demo.reset" } })).toBe(1);
  });

  it("orders ports, writes the trail reset then sample_loaded, and backdates the history", async () => {
    const { ports, calls } = fakePorts();
    const before = Date.now();
    const result = await loadSample(db, ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    expect(result.evidenceFailed).toBe(0);
    // After the commit: stale jobs drained before the sample's evidence goes in (#7), evidence
    // wiped, then put; sessions end only once the sample is in.
    const puts = calls.filter((c) => c === "putEvidence").length;
    expect(puts).toBeGreaterThan(0);
    expect(calls).toEqual([
      "drainQueues",
      "wipeEvidence",
      ...Array<string>(puts).fill("putEvidence"),
      "wipeSessions",
      "enqueueLibraryEmbed",
    ]);

    const trail = await db.auditEvent.findMany({
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    const reset = trail.find((e) => e.action === "demo.reset");
    const loaded = trail.at(-1);
    expect(loaded).toMatchObject({
      action: "demo.sample_loaded",
      actorUserId: null,
      afterRef: {
        actorEmail: CLI.email,
        risks: result.risks,
        people: result.people,
      },
    });
    expect(reset?.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(loaded?.occurredAt.getTime()).toBeGreaterThan(reset?.occurredAt.getTime() ?? 0);
    expect(trail.filter((e) => e.action.startsWith("demo.")).map((e) => e.action)).toEqual([
      "demo.reset",
      "demo.sample_loaded",
    ]);
    // Everything else is history, before the reset.
    const history = trail.filter((e) => !e.action.startsWith("demo."));
    expect(history.length).toBeGreaterThan(500);
    for (const e of history)
      expect(e.occurredAt.getTime()).toBeLessThan(reset?.occurredAt.getTime() ?? 0);
    expect(trail.findIndex((e) => e.action === "demo.reset")).toBe(history.length);

    // Matches the plan: same backdated times as rowsFor gives.
    const plan = planSampleYear(NOW);
    const rows = rowsFor(plan, {
      now: NOW,
      library: await loadLibraryIds(db),
      loader: null,
      bootstrapEmail: null,
    });
    const iso = (d: Date) => d.toISOString();
    expect(history.map((e) => iso(e.occurredAt)).sort()).toEqual(
      rows.auditEvents.map((e) => iso(e.occurredAt)).sort(),
    );
    const versions = await db.riskVersion.findMany({
      select: { createdAt: true },
    });
    expect(versions.map((v) => iso(v.createdAt)).sort()).toEqual(
      rows.riskVersions.map((v) => iso(v.createdAt)).sort(),
    );
    expect(Math.max(...versions.map((v) => v.createdAt.getTime()))).toBeLessThan(NOW.getTime());
  });

  it("completes within 30 seconds", async () => {
    const t0 = Date.now();
    const { ms } = await loadSample(db, fakePorts().ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    const wall = Date.now() - t0;
    console.log(`sample load: ${String(ms)} ms (wall ${String(wall)} ms)`);
    expect(ms).toBeLessThan(30_000);
    expect(wall).toBeLessThan(30_000);
  });

  it("loads the EU AI Act module on, its four systems, obligations and risk link", async () => {
    await loadSample(db, fakePorts().ports, CLI, { now: NOW, bootstrapEmail: null });
    expect(await db.organisationModule.findMany({ select: { key: true } })).toEqual([
      { key: "eu_ai_act" },
    ]);
    const systems = await db.aiSystem.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, riskClass: true, _count: { select: { obligations: true } } },
    });
    expect(systems.map((s) => [s.name, s.riskClass])).toEqual([
      ["Credit scoring engine", "high_risk"],
      ["Customer service chatbot", "limited_risk"],
      ["Transaction fraud detector", "minimal_risk"],
      ["CV screening tool", "high_risk"],
    ]);
    expect(systems.every((s) => s._count.obligations > 0)).toBe(true);
    expect(await db.aiSystemRisk.count()).toBe(1);
    expect(
      await db.organisationFramework.count({
        where: { frameworkVersion: { key: "eu-ai-act-2024-1689" } },
      }),
    ).toBe(1);
  });

  it("sets the Risk reference sequence so the next risk is n + 1", async () => {
    const { risks } = await loadSample(db, fakePorts().ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    const reporter = await db.user.findFirstOrThrow();
    const next = await db.risk.create({
      data: {
        title: "Next risk",
        scenario: "s",
        threat: "t",
        consequence: "c",
        reporterId: reporter.id,
        aiAssisted: false,
      },
    });
    expect(next.reference).toBe(risks + 1);
  });

  it("keeps the rows and reports evidenceFailed when evidence uploads fail", async () => {
    const { ports } = fakePorts({ failEvidence: 2 });
    const result = await loadSample(db, ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    expect(result.evidenceFailed).toBe(2);
    expect(await db.risk.count()).toBe(result.risks);
    expect(await db.evidence.count()).toBeGreaterThan(2);
  });

  it("gives the loader their exact sign-in and administrator; a CLI load has no loader", async () => {
    await loadSample(db, fakePorts().ports, LOADER, {
      now: NOW,
      bootstrapEmail: null,
    });
    const me = await db.user.findFirstOrThrow({
      where: { idpIssuer: LOADER.idpIssuer, idpSubject: LOADER.idpSubject },
      include: { roleAssignments: true },
    });
    expect(me.email).toBe(LOADER.email);
    expect(me.roleAssignments.map((r) => r.role)).toContain("administrator");

    await loadSample(db, fakePorts().ports, CLI, {
      now: NOW,
      bootstrapEmail: null,
    });
    expect(await db.user.count({ where: { idpSubject: LOADER.idpSubject } })).toBe(0);
  });
});

describe("steps outside the database (#7)", () => {
  it("a load tries every step after a failed one and reports all the failures together", async () => {
    const { ports, calls } = fakePorts({ fail: ["drainQueues", "wipeSessions"] });
    const error = await loadSample(db, ports, CLI, { now: NOW, bootstrapEmail: null }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(DemoPortsError);
    const failure = error as DemoPortsError;
    expect(failure.failures).toEqual([
      { step: "drainQueues", message: "drainQueues down" },
      { step: "wipeSessions", message: "wipeSessions down" },
    ]);
    expect(failure.message).toMatch(/^The sample data was loaded, but 2 follow-up steps failed/);
    expect(failure.message).toContain("drainQueues: drainQueues down");
    // Every step still ran, and the sample is in.
    expect(calls[0]).toBe("drainQueues");
    expect(calls).toContain("putEvidence");
    expect(calls.slice(-2)).toEqual(["wipeSessions", "enqueueLibraryEmbed"]);
    expect(await db.risk.count()).toBeGreaterThan(0);
  });

  it("a reset tries every step after a failed one and reports all the failures together", async () => {
    const { ports, calls } = fakePorts({ fail: ["wipeEvidence", "enqueueLibraryEmbed"] });
    const error = await resetInstance(db, ports, CLI).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(DemoPortsError);
    expect((error as DemoPortsError).failures.map((f) => f.step)).toEqual([
      "wipeEvidence",
      "enqueueLibraryEmbed",
    ]);
    expect((error as DemoPortsError).message).toMatch(/^The reset was done, but 2 follow-up/);
    expect(calls).toEqual(["drainQueues", "wipeEvidence", "wipeSessions", "enqueueLibraryEmbed"]);
    expect(await db.auditEvent.count({ where: { action: "demo.reset" } })).toBe(1);
  });
});

describe("one locked transaction (Ruling R12)", () => {
  it("a load that fails after the truncate rolls back: the previous data stays", async () => {
    await loadSample(db, fakePorts().ports, LOADER, { now: NOW, bootstrapEmail: null });
    const before = await counts();
    const trail = await db.auditEvent.findMany({ orderBy: { id: "asc" }, select: { id: true } });
    // Fails the first sample risk insert, which runs after the truncate and the reset audit.
    await db.$executeRawUnsafe(`CREATE FUNCTION demo_test_fail() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected load failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER demo_test_fail BEFORE INSERT ON "Risk"
      FOR EACH STATEMENT EXECUTE FUNCTION demo_test_fail()`);
    const { ports, calls } = fakePorts();
    try {
      await expect(
        loadSample(db, ports, CLI, {
          now: new Date(NOW.getTime() + 86_400_000),
          bootstrapEmail: null,
        }),
      ).rejects.toThrow(/injected load failure/);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER demo_test_fail ON "Risk"`);
      await db.$executeRawUnsafe(`DROP FUNCTION demo_test_fail()`);
    }
    expect(await counts()).toEqual(before);
    expect(await db.auditEvent.findMany({ orderBy: { id: "asc" }, select: { id: true } })).toEqual(
      trail,
    );
    expect(await db.user.count({ where: { idpSubject: LOADER.idpSubject } })).toBe(1);
    // Nothing outside the database is touched: sessions survive a failed load.
    expect(calls).toEqual([]);
  });

  it("a concurrent reset and load serialise on the demo lock and both complete", async () => {
    // Hold the demo lock, start both, and check both wait on it.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_LOCK}))`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    const load = loadSample(db, fakePorts().ports, CLI, { now: NOW, bootstrapEmail: null });
    const reset = resetInstance(db, fakePorts().ports, LOADER);
    let waiting = 0;
    for (let i = 0; i < 100 && waiting < 2; i += 1) {
      const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted`;
      waiting = Number(rows[0]?.n ?? 0);
      if (waiting < 2) await new Promise((r) => setTimeout(r, 50));
    }
    expect(waiting).toBe(2);
    release();
    await holder;
    await Promise.all([load, reset]);

    // One of the two ended last; either way the trail starts with exactly one reset.
    const actions = (
      await db.auditEvent.findMany({
        where: { action: { startsWith: "demo." } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      })
    ).map((e) => e.action);
    expect(actions[0]).toBe("demo.reset");
    expect(actions.filter((a) => a === "demo.reset")).toHaveLength(1);
    expect([["demo.reset"], ["demo.reset", "demo.sample_loaded"]]).toContainEqual(actions);
    if (actions.length === 2) expect(await db.risk.count()).toBeGreaterThan(0);
    else expect(await db.risk.count()).toBe(0);
  });

  it("a concurrent load and load both complete with the same result", async () => {
    const opts = { now: NOW, bootstrapEmail: null };
    const [a, b] = await Promise.all([
      loadSample(db, fakePorts().ports, CLI, opts),
      loadSample(db, fakePorts().ports, CLI, opts),
    ]);
    expect(a.risks).toBe(b.risks);
    expect(await db.risk.count()).toBe(a.risks);
    expect(await db.auditEvent.count({ where: { action: "demo.reset" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "demo.sample_loaded" } })).toBe(1);
  });
});

/** Polls `ready` every 25 ms for up to about 10 s. */
async function waitFor(ready: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 400; i += 1) {
    if (await ready()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("truncate lock order (#7)", () => {
  it("does not deadlock with an app transaction that locks the tables in another order", async () => {
    await loadSample(db, fakePorts().ports, CLI, { now: NOW, bootstrapEmail: null });
    // The app transaction holds "User" (which sorts late), waits until the load is stuck on it
    // while holding the tables before it, then reads "Approval" (which sorts early). Without
    // a bounded lock wait this is a deadlock, and Postgres cancels one of the two.
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const app = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE "User" SET "displayName" = "displayName"`;
        locked();
        const waiting = await waitFor(async () => {
          const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks
            WHERE locktype = 'relation' AND mode = 'AccessExclusiveLock' AND NOT granted`;
          return Number(rows[0]?.n ?? 0) > 0;
        });
        expect(waiting).toBe(true);
        return tx.approval.count();
      },
      { timeout: 30_000 },
    );
    await isLocked;
    const load = loadSample(db, fakePorts().ports, CLI, { now: NOW, bootstrapEmail: null });
    const [approvals, loaded] = await Promise.all([app, load]);
    expect(approvals).toBeGreaterThan(0);
    expect(await db.risk.count()).toBe(loaded.risks);
  });
});
