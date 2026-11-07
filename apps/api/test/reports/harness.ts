import type { DynamicModule, Type } from "@nestjs/common";
import type { Clock } from "@isms/domain";
import request from "supertest";
import { ReportsModule } from "../../src/reports/index.js";
import { type Who, db, reportBody, risksHarness } from "../risks/harness.js";

type Role =
  "administrator" | "ciso" | "risk_owner" | "risk_approver" | "contributor" | "viewer" | "auditor";

/**
 * The risks harness with the reports routes. `grant` adds a role assignment row, so a test can
 * make, say, Carl (an organisation contributor) an auditor of site A only. `imports` adds
 * modules, such as an AiModule with a known secrets key; `clock` replaces the services' clock.
 */
export function reportsHarness(
  options: { imports?: (DynamicModule | Type)[]; clock?: Clock } = {},
) {
  const h = risksHarness({
    imports: [ReportsModule, ...(options.imports ?? [])],
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return {
    ...h,
    async grant(who: Who, role: Role, scope: "org" | "siteA" | "siteB"): Promise<void> {
      await db.roleAssignment.create({
        data: {
          userId: h.userIds[who],
          role,
          grantedById: h.userIds.cora,
          ...(scope === "org"
            ? { scopeType: "ORGANISATION" }
            : { scopeType: "SITE", siteId: h.sites[scope] }),
        },
      });
    },
    async put(path: string, body: unknown, who: Who) {
      return request(h.server())
        .put(path)
        .set("authorization", await h.auth(who))
        .send(body as object);
    },
    /** Reports a risk as Rita (optionally at a site), then sets fields directly. Returns id and reference. */
    async seedRisk(
      fields: Record<string, unknown> = {},
      site?: "siteA" | "siteB",
    ): Promise<{ id: string; reference: number }> {
      const res = await h.post(
        "/api/v1/risks",
        reportBody(site ? { siteId: h.sites[site] } : {}),
        "rita",
      );
      if (res.status !== 201) throw new Error(JSON.stringify(res.body));
      const id = (res.body as { id: string }).id;
      const row = await db.risk.update({
        where: { id },
        data: fields,
        select: { reference: true },
      });
      return { id, reference: row.reference };
    },
  };
}

/** A library control created with the owner connection (library tables are read-only to the app). */
export async function control(code: string, title = `Control ${code}`): Promise<string> {
  return (
    await db.control.create({
      data: {
        code,
        title,
        description: "A control.",
        guidance: [],
        category: "governance",
        libraryVersion: "test",
      },
    })
  ).id;
}
