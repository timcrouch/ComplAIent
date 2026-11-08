import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { databaseTestConfig, loadConfig, redisConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import { DEMO_LOCK, PENDING_ISSUER, SAMPLE_PEOPLE, type DemoPorts, loadSample } from "@isms/demo";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationModule } from "../../src/authorization/index.js";
import {
  DEMO_LOCK as SIGN_IN_DEMO_LOCK,
  IdentityModule,
  type IdentityOptions,
  UserProvisioningService,
  type VerifiedToken,
} from "../../src/identity/index.js";
import { InfrastructureModule, PlatformModule } from "../../src/platform/index.js";

const env = loadConfig(z.object({ ...databaseTestConfig.shape, ...redisConfig.shape }));
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const ISSUER = "https://idp.test/realms/isms";
const BOOTSTRAP_EMAIL = "Boss@Bank.example";

async function buildApp(identity: Partial<IdentityOptions>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      PlatformModule.forRoot({
        logLevel: "silent",
        service: "isms-api-test",
        rateLimitPerMinute: 1000,
        rateLimitPerIpPerMinute: 1000,
        throttleTrustedIps: [],
      }),
      InfrastructureModule.forRoot({ databaseUrl: env.DATABASE_TEST_URL, redisUrl: env.REDIS_URL }),
      IdentityModule.forRoot({
        issuer: ISSUER,
        audience: "isms-api",
        bootstrapAdminEmail: BOOTSTRAP_EMAIL,
        ...identity,
      }),
      AuthorizationModule.forRoot(),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  await app.init();
  return app;
}

const token = (subject: string, email: string, emailVerified = true): VerifiedToken => ({
  issuer: ISSUER,
  subject,
  email,
  emailVerified,
  name: subject,
  authTime: Math.floor(Date.now() / 1000),
  authTimeSource: "auth_time",
});

/** A placeholder as the sample generator writes it, holding one role. */
async function placeholder(email: string, role: "risk_owner" | "administrator" = "risk_owner") {
  const user = await db.user.create({
    data: { idpIssuer: PENDING_ISSUER, idpSubject: email, email, displayName: `P ${email}` },
  });
  await db.roleAssignment.create({
    data: { userId: user.id, role, scopeType: "ORGANISATION", grantedById: user.id },
  });
  return user.id;
}

const claims = () => db.auditEvent.findMany({ where: { action: "identity.placeholder_claimed" } });

describe("placeholder claim on sign-in (P9-R3)", () => {
  let app: INestApplication;
  let service: UserProvisioningService;

  beforeAll(async () => {
    app = await buildApp({ demoTools: true });
    service = app.get(UserProvisioningService);
  });
  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it("a verified @example.test sign-in claims the placeholder and keeps its roles", async () => {
    const id = await placeholder("olga@example.test");
    const actor = await service.resolve(token("kc-olga", "Olga@Example.TEST"), {
      requestId: "claim-0001",
    });
    expect(actor.userId).toBe(id);
    expect(actor.roles).toEqual([
      { role: "risk_owner", scope: { type: "organisation", id: null } },
    ]);
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ idpIssuer: ISSUER, idpSubject: "kc-olga" });
    expect(await db.user.count()).toBe(1);
    const rows = await claims();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: id,
      objectType: "User",
      objectId: id,
      requestId: "claim-0001",
      afterRef: { email: "olga@example.test", idpIssuer: ISSUER },
    });
    // The next sign-in finds the row by issuer and subject: no second claim.
    const again = await service.resolve(token("kc-olga", "olga@example.test"), {
      requestId: "claim-0001b",
    });
    expect(again.userId).toBe(id);
    expect(await claims()).toHaveLength(1);
  });

  it("an unverified email claims nothing: a new user with no roles", async () => {
    const id = await placeholder("olga@example.test");
    const actor = await service.resolve(token("kc-olga", "olga@example.test", false), {
      requestId: "claim-0002",
    });
    expect(actor.userId).not.toBe(id);
    expect(actor.roles).toEqual([]);
    expect((await db.user.findUniqueOrThrow({ where: { id } })).idpIssuer).toBe(PENDING_ISSUER);
    expect(await claims()).toHaveLength(0);
  });

  it("a real-looking address is never claimable, even with a pending row", async () => {
    for (const email of ["someone@bank.example", "olga@example.test.evil", "olga@example.testx"]) {
      const id = await placeholder(email);
      const actor = await service.resolve(token(`kc-${email}`, email), { requestId: "claim-0003" });
      expect(actor.userId).not.toBe(id);
      expect(actor.roles).toEqual([]);
      expect((await db.user.findUniqueOrThrow({ where: { id } })).idpIssuer).toBe(PENDING_ISSUER);
    }
    expect(await claims()).toHaveLength(0);
  });

  it("the bootstrap email is claimable (case-insensitive): config already trusts it", async () => {
    const id = await placeholder("boss@bank.example", "administrator");
    const actor = await service.resolve(token("kc-boss", "BOSS@bank.EXAMPLE"), {
      requestId: "claim-0004",
    });
    expect(actor.userId).toBe(id);
    expect(actor.roles.map((r) => r.role)).toEqual(["administrator"]);
    expect(await db.user.count()).toBe(1);
    expect(await claims()).toHaveLength(1);
  });

  it("an existing user for (issuer, subject) is used as is; the placeholder stays pending", async () => {
    const existing = await db.user.create({
      data: {
        idpIssuer: ISSUER,
        idpSubject: "kc-olga",
        email: "old@example.test",
        displayName: "O",
      },
    });
    const id = await placeholder("olga@example.test");
    const actor = await service.resolve(token("kc-olga", "olga@example.test"), {
      requestId: "claim-0005",
    });
    expect(actor.userId).toBe(existing.id);
    expect((await db.user.findUniqueOrThrow({ where: { id } })).idpIssuer).toBe(PENDING_ISSUER);
    expect(await claims()).toHaveLength(0);
  });

  it("two concurrent first sign-ins of one identity give one user: the sign-in lock orders them", async () => {
    for (let round = 0; round < 5; round++) {
      await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
      const actors = await Promise.all([
        service.resolve(token("kc-new", "new@bank.example"), { requestId: "first-a-0001" }),
        service.resolve(token("kc-new", "new@bank.example"), { requestId: "first-b-0001" }),
      ]);
      expect(actors[0].userId).toBe(actors[1].userId);
      expect(await db.user.count()).toBe(1);
    }
  });

  it("two concurrent claims of one placeholder give one user and one claim (Review Focus 2)", async () => {
    for (let round = 0; round < 5; round++) {
      await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
      const id = await placeholder("rita@example.test");
      const actors = await Promise.all([
        service.resolve(token("kc-rita", "rita@example.test"), { requestId: "race-a-0001" }),
        service.resolve(token("kc-rita", "RITA@example.test"), { requestId: "race-b-0001" }),
      ]);
      expect(actors.map((a) => a.userId)).toEqual([id, id]);
      for (const a of actors) expect(a.roles.map((r) => r.role)).toEqual(["risk_owner"]);
      expect(await db.user.count()).toBe(1);
      expect(await claims()).toHaveLength(1);
    }
  });
});

const noPorts: DemoPorts = {
  wipeEvidence: () => Promise.resolve(0),
  putEvidence: () => Promise.resolve(),
  wipeSessions: () => Promise.resolve(0),
  drainQueues: () => Promise.resolve(),
  enqueueLibraryEmbed: () => Promise.resolve(),
};

/** Polls pg_locks until `ready` holds (or gives up after about 10 s). */
async function waitForLocks(
  ready: (rows: { locktype: string; mode: string; granted: boolean }[]) => boolean,
) {
  for (let i = 0; i < 200; i++) {
    const rows = await db.$queryRaw<{ locktype: string; mode: string; granted: boolean }[]>`
      SELECT locktype, mode, granted FROM pg_locks WHERE pid <> pg_backend_pid()`;
    if (ready(rows)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("a sign-in during a sample load (Ruling R12)", () => {
  let app: INestApplication;
  let service: UserProvisioningService;

  beforeAll(async () => {
    app = await buildApp({ demoTools: true });
    service = app.get(UserProvisioningService);
  });
  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterAll(async () => {
    await app.close();
  });

  it("fences sign-ins with the demo package's lock (the identity module keeps its own copy)", () => {
    expect(SIGN_IN_DEMO_LOCK).toBe(DEMO_LOCK);
  });

  it("waits for the load, then claims its placeholder: one user per email, roles kept", async () => {
    const signIns = SAMPLE_PEOPLE.filter((p) => p.signsIn);
    const opts = { now: new Date(), bootstrapEmail: BOOTSTRAP_EMAIL };
    // A first load, and every sample person signed in: the instance a trainer reloads.
    await loadSample(db, noPorts, { email: "cli@example.test", cli: true }, opts);
    for (const p of signIns)
      await service.resolve(token(`kc-${p.key}`, p.email), { requestId: "pre" });
    expect(await db.user.count({ where: { idpIssuer: ISSUER } })).toBe(signIns.length);

    // Hold the demo lock so the reload queues behind it, then release it and sign everyone in
    // once the reload has truncated. (A sign-in already resolving when the reload starts: the
    // next test.)
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_LOCK}))`;
      locked();
      await held;
    });
    await isLocked;
    const reload = loadSample(db, noPorts, { email: "cli@example.test", cli: true }, opts);
    expect(
      await waitForLocks((rows) => rows.some((r) => r.locktype === "advisory" && !r.granted)),
    ).toBe(true);
    release();
    await holder;
    // The reload has truncated once it holds the tables' ACCESS EXCLUSIVE locks.
    expect(
      await waitForLocks((rows) =>
        rows.some(
          (r) => r.locktype === "relation" && r.mode === "AccessExclusiveLock" && r.granted,
        ),
      ),
    ).toBe(true);
    let reloaded = false;
    void reload.then(() => (reloaded = true));
    const resolving = signIns.map((p) =>
      service.resolve(token(`kc-${p.key}`, p.email), { requestId: `during-${p.key}` }),
    );
    // The sign-ins wait while the reload runs: on the demo lock, which a sign-in in demo mode
    // takes shared (#7), or on the truncate's table locks.
    const blocked = await waitForLocks((rows) =>
      rows.some((r) => (r.locktype === "relation" || r.locktype === "advisory") && !r.granted),
    );
    expect(reloaded).toBe(false);
    expect(blocked).toBe(true);
    const [actors] = await Promise.all([Promise.all(resolving), reload]);

    for (const [i, p] of signIns.entries()) {
      const users = await db.user.findMany({
        where: { email: { equals: p.email, mode: "insensitive" } },
        include: { roleAssignments: true },
      });
      expect(users, p.email).toHaveLength(1);
      const [user] = users;
      expect(user).toMatchObject({ idpIssuer: ISSUER, idpSubject: `kc-${p.key}` });
      expect(actors[i]?.userId).toBe(user?.id);
      expect(user?.roleAssignments.map((r) => r.role).sort()).toEqual(
        p.roles.map((r) => r.role).sort(),
      );
    }
    // No pending row for a person who signed in, and no roleless sign-in row.
    expect(
      await db.user.count({ where: { idpIssuer: ISSUER, roleAssignments: { none: {} } } }),
    ).toBe(0);
    // The trail: the claims come after the reload's demo.sample_loaded.
    const trail = await db.auditEvent.findMany({
      where: {
        action: { in: ["demo.reset", "demo.sample_loaded", "identity.placeholder_claimed"] },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    expect(trail.map((e) => e.action)).toEqual([
      "demo.reset",
      "demo.sample_loaded",
      ...signIns.map(() => "identity.placeholder_claimed"),
    ]);
  });

  it("a sign-in already resolving when a reload starts never leaves a user without roles (#7)", async () => {
    const olga = SAMPLE_PEOPLE.find((p) => p.key === "olga");
    if (!olga) throw new Error("no sample person olga");
    const olgaToken = token("kc-olga", olga.email);
    const opts = { now: new Date(), bootstrapEmail: BOOTSTRAP_EMAIL };
    await loadSample(db, noPorts, { email: "cli@example.test", cli: true }, opts);
    await service.resolve(olgaToken, { requestId: "pre" });

    // Pause the next sign-in after its claim check found her user and before the upsert looks
    // it up again: the window in which a reload used to replace the row (#7).
    let paused!: () => void;
    const isPaused = new Promise<void>((r) => (paused = r));
    let resume!: () => void;
    const gate = new Promise<void>((r) => (resume = r));
    const target = service as unknown as { upsertUser: (...args: unknown[]) => Promise<string> };
    const upsert = target.upsertUser.bind(service);
    const spy = vi.spyOn(target, "upsertUser").mockImplementationOnce(async (...args) => {
      paused();
      await gate;
      return upsert(...args);
    });
    try {
      const signIn = service.resolve(olgaToken, { requestId: "during" });
      await isPaused;
      const reload = loadSample(db, noPorts, { email: "cli@example.test", cli: true }, opts);
      let reloaded = false;
      void reload.then(() => (reloaded = true));
      // The reload waits for the sign-in on the demo lock. (Before #7 it ran to the end.)
      const waits = await waitForLocks(
        (rows) => reloaded || rows.some((r) => r.locktype === "advisory" && !r.granted),
      );
      expect(waits).toBe(true);
      expect(reloaded).toBe(false);
      resume();
      await Promise.all([signIn, reload]);
    } finally {
      resume();
      spy.mockRestore();
    }

    // Her row is the reload's placeholder, holding her roles; no sign-in row without roles.
    const users = await db.user.findMany({
      where: { email: { equals: olga.email, mode: "insensitive" } },
      include: { roleAssignments: true },
    });
    expect(users).toHaveLength(1);
    expect(users[0]?.roleAssignments.map((r) => r.role)).toEqual(olga.roles.map((r) => r.role));
    expect(
      await db.user.count({ where: { idpIssuer: ISSUER, roleAssignments: { none: {} } } }),
    ).toBe(0);
    // Her next sign-in claims it as usual.
    const again = await service.resolve(olgaToken, { requestId: "after" });
    expect(again.userId).toBe(users[0]?.id);
    expect(again.roles.map((r) => r.role)).toEqual(olga.roles.map((r) => r.role));
  });
});

describe("placeholder claim with demo mode off", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp({ demoTools: false });
  });
  beforeEach(async () => {
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it("claims nothing, even for a verified @example.test sign-in", async () => {
    const id = await placeholder("olga@example.test");
    const actor = await app
      .get(UserProvisioningService)
      .resolve(token("kc-olga", "olga@example.test"), { requestId: "off-0001" });
    expect(actor.userId).not.toBe(id);
    expect(actor.roles).toEqual([]);
    expect(await claims()).toHaveLength(0);
  });
});
