import { SAMPLE_ORG_NAME, SAMPLE_RISK_COUNT } from "@isms/demo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ErrorBody, PEOPLE, db, demoHarness, detailPaths } from "./harness.js";

const LOAD_TIMEOUT = 90_000;
const trail = async () =>
  (await db.auditEvent.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })).map(
    (e) => e.action,
  );
const stale = () => ({ auth_time: Math.floor(Date.now() / 1000) - 3600 });

describe("demo routes, demo mode on (spec §5.1, §5.4)", () => {
  const h = demoHarness({ demo: true });

  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(async () => {
    await h.stop();
    await db.$disconnect();
  });

  it("GET /demo: an administrator sees demo mode and the organisation name", async () => {
    let res = await h.get("/api/v1/demo");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, organisationName: null });
    await db.organisation.create({ data: { name: "Acme Bank AG" } });
    res = await h.get("/api/v1/demo");
    expect(res.body).toEqual({ enabled: true, organisationName: "Acme Bank AG" });
  });

  it("a contributor is refused every demo route (403)", async () => {
    expect((await h.get("/api/v1/demo", "rita")).status).toBe(403);
    for (const path of ["/api/v1/demo/reset", "/api/v1/demo/sample"]) {
      const res = await h.post(path, { confirm: "RESET" }, "rita");
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("FORBIDDEN");
    }
    expect(await db.user.count()).toBe(3);
  });

  it("without a recent sign-in both actions get the recent-auth refusal", async () => {
    for (const path of ["/api/v1/demo/reset", "/api/v1/demo/sample"]) {
      const res = await h.post(path, { confirm: "RESET" }, "admin", stale());
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe("RECENT_AUTH_REQUIRED");
    }
    // Reading the status needs no recent sign-in.
    expect((await h.get("/api/v1/demo", "admin", stale())).status).toBe(200);
    expect(await db.user.count()).toBe(3);
    expect(h.fake.calls).toEqual([]);
  });

  it("a wrong confirmation is 400 confirmationMismatch and changes nothing", async () => {
    for (const path of ["/api/v1/demo/reset", "/api/v1/demo/sample"]) {
      for (const confirm of ["reset", "RESET!", "", "Acme"]) {
        const res = await h.post(path, { confirm });
        expect(res.status).toBe(400);
        expect((res.body as ErrorBody).error.code).toBe("VALIDATION_FAILED");
        expect(detailPaths(res)).toEqual(["confirmationMismatch"]);
      }
    }
    // A missing body is ordinary validation, not a mismatch.
    const missing = await h.post("/api/v1/demo/reset", {});
    expect(missing.status).toBe(400);
    expect(detailPaths(missing)).toEqual(["confirm"]);
    expect(await db.user.count()).toBe(3);
    expect(h.fake.calls).toEqual([]);
  });

  it("with an organisation, the name is expected: trimmed, case-sensitive; RESET no longer works", async () => {
    await db.organisation.create({ data: { name: SAMPLE_ORG_NAME } });
    for (const confirm of ["RESET", SAMPLE_ORG_NAME.toLowerCase(), SAMPLE_ORG_NAME.toUpperCase()]) {
      const res = await h.post("/api/v1/demo/reset", { confirm });
      expect(res.status).toBe(400);
      expect(detailPaths(res)).toEqual(["confirmationMismatch"]);
    }
    expect(await db.organisation.count()).toBe(1);
    const res = await h.post("/api/v1/demo/reset", { confirm: `  ${SAMPLE_ORG_NAME} \n` });
    expect(res.status).toBe(204);
    expect(await db.organisation.count()).toBe(0);
  });

  it("reset: 204 with no body, a fresh instance whose trail is [demo.reset]", async () => {
    const res = await h.post("/api/v1/demo/reset", { confirm: "RESET" });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await trail()).toEqual(["demo.reset"]);
    const event = await db.auditEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      actorUserId: null,
      afterRef: { actorEmail: PEOPLE.admin.email },
    });
    expect(await db.user.count()).toBe(0);
    expect(await db.roleAssignment.count()).toBe(0);
    // The library is re-synced; the side effects ran through the ports.
    expect(await db.control.count()).toBeGreaterThan(0);
    expect(h.fake.calls).toEqual([
      "drainQueues",
      "wipeEvidence",
      "wipeSessions",
      "enqueueLibraryEmbed",
    ]);
    // After reset there is no admin; the bootstrap rule applies again at the next sign-in.
    const me = await h.get("/api/v1/demo");
    expect(me.status).toBe(403);
  });

  it(
    "load: returns the counts and leaves the sample company in place",
    async () => {
      const res = await h.post("/api/v1/demo/sample", { confirm: "RESET" });
      expect(res.status).toBe(200);
      const body = res.body as {
        risks: number;
        people: number;
        ms: number;
        evidenceFailed: number;
      };
      expect(body.risks).toBe(SAMPLE_RISK_COUNT);
      expect(body.people).toBe(await db.user.count());
      expect(body.evidenceFailed).toBe(0);
      expect(body.ms).toBeGreaterThan(0);
      expect(await db.risk.count()).toBe(SAMPLE_RISK_COUNT);
      expect((await db.organisation.findFirstOrThrow()).name).toBe(SAMPLE_ORG_NAME);
      const actions = await trail();
      // The sample's own events are backdated; the reset is stamped now, the load after it.
      expect(actions.filter((a) => a.startsWith("demo."))).toEqual([
        "demo.reset",
        "demo.sample_loaded",
      ]);
      expect(actions.slice(-2)).toEqual(["demo.reset", "demo.sample_loaded"]);
      expect(h.fake.calls).toContain("putEvidence");
      // Stale jobs are drained before the fresh sample's evidence goes in (#7).
      expect(h.fake.calls[0]).toBe("drainQueues");
      // The organisation now exists, so the next confirmation is its name.
      const again = await h.post("/api/v1/demo/reset", { confirm: "RESET" });
      expect(again.status).toBe(400);
      expect(detailPaths(again)).toEqual(["confirmationMismatch"]);
    },
    LOAD_TIMEOUT,
  );

  it(
    "the loader (not bootstrap, not @example.test) is still an administrator after loading (Review Focus 1)",
    async () => {
      const res = await h.post("/api/v1/demo/sample", { confirm: "RESET" }, "loader");
      expect(res.status).toBe(200);
      const loader = await db.user.findMany({ where: { email: PEOPLE.loader.email } });
      expect(loader).toHaveLength(1);
      expect(loader[0]?.idpSubject).toBe(PEOPLE.loader.sub);
      const roles = await db.roleAssignment.findMany({ where: { userId: loader[0]?.id ?? "" } });
      expect(roles.map((r) => [r.role, r.scopeType])).toContainEqual([
        "administrator",
        "ORGANISATION",
      ]);
      // The same sign-in resolves to that row, with administrator rights, and no claim.
      const status = await h.get("/api/v1/demo", "loader");
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ enabled: true, organisationName: SAMPLE_ORG_NAME });
      expect(await db.user.count({ where: { email: PEOPLE.loader.email } })).toBe(1);
      const loaded = await db.auditEvent.findFirstOrThrow({
        where: { action: "demo.sample_loaded" },
      });
      expect(loaded.afterRef).toMatchObject({ actorEmail: PEOPLE.loader.email });
      expect(await db.auditEvent.count({ where: { action: "identity.placeholder_claimed" } })).toBe(
        0,
      );
    },
    LOAD_TIMEOUT,
  );
});

describe("demo routes, demo mode off", () => {
  const h = demoHarness({ demo: false });

  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(async () => {
    await h.stop();
    await db.$disconnect();
  });

  it("every demo route is 404 (not 403), signed in as an administrator or not at all", async () => {
    const routes: ["get" | "post", string][] = [
      ["get", "/api/v1/demo"],
      ["post", "/api/v1/demo/reset"],
      ["post", "/api/v1/demo/sample"],
    ];
    for (const [method, path] of routes) {
      const signedIn =
        method === "get" ? await h.get(path) : await h.post(path, { confirm: "RESET" });
      expect(signedIn.status).toBe(404);
      expect((await h.anonymous(method, path)).status).toBe(404);
    }
    expect(await db.user.count()).toBe(3);
  });
});
