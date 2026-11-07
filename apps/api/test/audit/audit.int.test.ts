import { databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { resetTestDatabase } from "@isms/database/testing";
import type { Request } from "express";
import { Logger } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  type AuditContext,
  type AuditSnapshot,
  AuditService,
  auditContextFrom,
} from "../../src/audit/index.js";
import type { PrismaService } from "../../src/platform/index.js";

const env = loadConfig(databaseTestConfig);
// The service writes as the runtime role (isms_app); assertions read as the owner.
const appDb: PrismaService = createPrismaClient(env.DATABASE_TEST_URL);
const db = createPrismaClient(env.DATABASE_OWNER_TEST_URL);
const audit = new AuditService(appDb);

const ACTOR = "0193a0c0-0000-7000-8000-0000000000aa";
const ctx: AuditContext = { actorUserId: ACTOR, requestId: "req-12345678", traceId: "trace-1" };

describe("AuditService.record", () => {
  // Dropping a credential key logs a warning by design; capture it so CI logs stay clean.
  let warn: MockInstance<Logger["warn"]>;
  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    await resetTestDatabase(env.DATABASE_OWNER_TEST_URL);
  });
  afterEach(() => {
    warn.mockRestore();
  });
  afterAll(async () => {
    await Promise.all([appDb.$disconnect(), db.$disconnect()]);
  });

  it("writes one row with the event and its context", async () => {
    await audit.record(
      { action: "t.done", objectType: "Thing", objectId: "42", before: { n: 1 }, after: { n: 2 } },
      ctx,
    );
    const rows = await db.auditEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: ACTOR,
      action: "t.done",
      objectType: "Thing",
      objectId: "42",
      beforeRef: { n: 1 },
      afterRef: { n: 2 },
      requestId: "req-12345678",
      traceId: "trace-1",
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("stores NULL for omitted before/after, actor and trace", async () => {
    await audit.record(
      { action: "t", objectType: "x", objectId: "1" },
      {
        actorUserId: null,
        requestId: "req-12345678",
      },
    );
    const row = await db.auditEvent.findFirstOrThrow();
    expect(row).toMatchObject({
      actorUserId: null,
      beforeRef: null,
      afterRef: null,
      traceId: null,
    });
  });

  it("strips secret-like keys", async () => {
    await audit.record(
      {
        action: "t",
        objectType: "x",
        objectId: "1",
        after: { apiKey: "k", nested: { refreshToken: "r" }, ok: 1 },
      },
      ctx,
    );
    const row = await db.auditEvent.findFirstOrThrow();
    expect(row.afterRef).toEqual({ nested: {}, ok: 1 });
  });

  it("strips at any depth, inside arrays, from before as well, and keeps non-secret values", async () => {
    await audit.record(
      {
        action: "t",
        objectType: "x",
        objectId: "1",
        before: {
          PASSWORD: "pw-1",
          clientSecret: "cs-1",
          list: [{ accessToken: "at-1", name: "n" }, 3, "plain"],
          a: { b: { c: { d: { api_key: "ak-1", keep: true } } } },
        },
      },
      ctx,
    );
    const row = await db.auditEvent.findFirstOrThrow();
    expect(row.beforeRef).toEqual({
      list: [{ name: "n" }, 3, "plain"],
      a: { b: { c: { d: { keep: true } } } },
    });
    expect(JSON.stringify(row.beforeRef)).not.toMatch(/pw-1|cs-1|at-1|ak-1/);
  });

  it("keeps domain keys that merely end in 'key'", async () => {
    await audit.record(
      {
        action: "t",
        objectType: "x",
        objectId: "1",
        after: { objectKey: "evidence/1", sortKey: 3, frameworkKey: "iso27001", keyLast4: "abcd" },
      },
      ctx,
    );
    expect((await db.auditEvent.findFirstOrThrow()).afterRef).toEqual({
      objectKey: "evidence/1",
      sortKey: 3,
      frameworkKey: "iso27001",
      keyLast4: "abcd",
    });
  });

  it("logs the name, never the value, of each dropped key", async () => {
    await audit.record(
      { action: "t", objectType: "x", objectId: "1", after: { clientSecret: "s3cr3t" } },
      ctx,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "audit.credential_key_dropped",
        action: "t",
        droppedField: "clientSecret",
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("s3cr3t");
  });

  it("does not mutate the caller's object", async () => {
    const after = { apiKey: "k", nested: { refreshToken: "r", keep: 1 }, list: [{ token: "t" }] };
    const copy = structuredClone(after);
    await audit.record({ action: "t", objectType: "x", objectId: "1", after }, ctx);
    expect(after).toEqual(copy);
  });

  it("rejects a cyclic snapshot and rolls back the caller's transaction", async () => {
    const after: Record<string, unknown> = { ok: 1 };
    after["self"] = after;
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.auditEvent.create({
          data: { action: "earlier", objectType: "x", objectId: "0", requestId: "req-12345678" },
        });
        await audit.record(
          { action: "t", objectType: "x", objectId: "1", after: after as unknown as AuditSnapshot },
          ctx,
          tx,
        );
      }),
    ).rejects.toThrow(TypeError);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("writes inside the caller's transaction and rolls back with it", async () => {
    const failure = new Error("roll back");
    await expect(
      appDb.$transaction(async (tx) => {
        await audit.record({ action: "t", objectType: "x", objectId: "1" }, ctx, tx);
        // Visible inside the transaction, so it was written through `tx`.
        expect(await tx.auditEvent.count()).toBe(1);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("commits with the caller's transaction", async () => {
    await appDb.$transaction(async (tx) => {
      await audit.record({ action: "t", objectType: "x", objectId: "1" }, ctx, tx);
    });
    expect(await db.auditEvent.count()).toBe(1);
  });
});

describe("auditContextFrom", () => {
  it("takes the actor and request id from the request, with no trace outside a span", () => {
    const req = { id: "req-abcdefgh", actor: { userId: ACTOR } } as unknown as Request;
    expect(auditContextFrom(req)).toEqual({ actorUserId: ACTOR, requestId: "req-abcdefgh" });
  });

  it("uses a null actor before authentication", () => {
    const req = { id: "req-abcdefgh" } as unknown as Request;
    expect(auditContextFrom(req)).toEqual({ actorUserId: null, requestId: "req-abcdefgh" });
  });
});
