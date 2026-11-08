import type { MeResponse, ModulesResponse, OrganisationResponse } from "@isms/contracts";
import { aiActRoutes } from "@isms/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEMS, type ErrorBody, type Who, aiActHarness, audits, db } from "./harness.js";

const ID = "0190a6f2-0000-7000-8000-0000000000aa";
const RISK = "0190a6f2-0000-7000-8000-0000000000bb";
const MODULE_PATH = "/api/v1/organisation/modules/eu_ai_act";

/** Every AI Act route with its placeholders filled in. */
const ROUTES = Object.values(aiActRoutes).map((route) => ({
  method: route.method,
  path: route.path.replace("{id}", ID).replace("{key}", "ai_literacy").replace("{riskId}", RISK),
}));

describe("the EU AI Act module switch", () => {
  const h = aiActHarness();
  beforeAll(() => h.start());
  beforeEach(() => h.reset());
  afterAll(() => h.stop());

  const call = async (method: string, path: string, who: Who) => {
    const agent = request(h.server());
    const req =
      method === "get"
        ? agent.get(path)
        : method === "post"
          ? agent.post(path)
          : method === "put"
            ? agent.put(path)
            : method === "patch"
              ? agent.patch(path)
              : agent.delete(path);
    return req.set("authorization", await h.auth(who)).send({});
  };
  const setModule = (enabled: unknown, who: Who = "admin") => h.put(MODULE_PATH, { enabled }, who);

  it("answers 404 on every /ai-act route while off, before the permission check", async () => {
    expect(ROUTES).toHaveLength(10);
    for (const route of ROUTES) {
      // Cora holds aiact.manage; Rita (contributor) holds no aiact permission at all.
      for (const who of ["cora", "rita"] as const) {
        const res = await call(route.method, route.path, who);
        expect(res.status, `${route.method} ${route.path} as ${who}`).toBe(404);
        expect((res.body as ErrorBody).error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("still asks for authentication first", async () => {
    const res = await request(h.server()).get(SYSTEMS);
    expect(res.status).toBe(401);
  });

  it("exists once on: the permission check applies again", async () => {
    await h.enableModule();
    expect((await h.get(SYSTEMS, "cora")).status).toBe(200);
    expect((await h.get(SYSTEMS, "rita")).status).toBe(403);
  });

  it("needs organisation.manage to switch, and audits each real change once", async () => {
    expect((await setModule(true, "cora")).status).toBe(403);
    const on = await setModule(true);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body as ModulesResponse).toEqual({ modules: ["eu_ai_act"] });
    expect((await setModule(true)).body as ModulesResponse).toEqual({ modules: ["eu_ai_act"] });
    const off = await setModule(false);
    expect(off.body as ModulesResponse).toEqual({ modules: [] });
    expect((await setModule(false)).status).toBe(200);

    const enabled = await audits("organisation.module_enabled");
    const disabled = await audits("organisation.module_disabled");
    expect(enabled).toHaveLength(1);
    expect(disabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      actorUserId: h.userIds.admin,
      objectType: "OrganisationModule",
      objectId: "eu_ai_act",
      beforeRef: { enabled: false },
      afterRef: { enabled: true },
    });
    expect(disabled[0]).toMatchObject({
      beforeRef: { enabled: true },
      afterRef: { enabled: false },
    });
  });

  it("refuses an unknown module and a body that is not a boolean", async () => {
    expect(
      (await h.put("/api/v1/organisation/modules/dora", { enabled: true }, "admin")).status,
    ).toBe(400);
    expect((await setModule("yes")).status).toBe(400);
  });

  it("keeps the module's data while off and shows it unchanged when back on", async () => {
    await setModule(true);
    const created = await h.createSystem();
    await setModule(false);
    expect((await h.get(`${SYSTEMS}/${created.id}`, "cora")).status).toBe(404);
    expect(await db.aiSystem.count()).toBe(1);
    await setModule(true);
    const back = await h.get(`${SYSTEMS}/${created.id}`, "cora");
    expect(back.status).toBe(200);
    expect(back.body).toEqual(created);
  });

  it("lists the modules on /me and /organisation for everyone signed in", async () => {
    const me = async (who: Who) => ((await h.get("/api/v1/me", who)).body as MeResponse).modules;
    const org = async (who: Who) =>
      ((await h.get("/api/v1/organisation", who)).body as OrganisationResponse).modules;
    expect(await me("rita")).toEqual([]);
    expect(await org("rita")).toEqual([]);
    await setModule(true);
    expect(await me("rita")).toEqual(["eu_ai_act"]);
    expect(await org("vera")).toEqual(["eu_ai_act"]);
    const setup = (await h.get("/api/v1/organisation", "admin")).body as OrganisationResponse;
    expect(setup.setup.missing).not.toContain("eu_ai_act");
  });
});
