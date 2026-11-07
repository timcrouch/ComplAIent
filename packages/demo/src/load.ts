import type { Prisma, PrismaClient } from "@isms/database";
import type { DemoActor, DemoPorts } from "./ports.js";
import { DEMO_TRANSACTION_OPTIONS, resetRows } from "./reset.js";
import { rowsFor } from "./rows.js";
import type { LibraryIds, LoaderIdentity, SampleRows } from "./types.js";
import { planSampleYear } from "./year.js";

/** The library's ids by key, code and "<framework version> <ref>", read after the sync. */
export async function loadLibraryIds(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<LibraryIds> {
  // One after another: inside a transaction the queries share one connection anyway.
  const versions = await db.frameworkVersion.findMany({ select: { id: true, key: true } });
  const controls = await db.control.findMany({ select: { id: true, code: true } });
  const requirements = await db.requirement.findMany({
    select: {
      id: true,
      ref: true,
      frameworkVersion: { select: { key: true } },
    },
  });
  return {
    frameworkVersions: Object.fromEntries(versions.map((v) => [v.key, v.id])),
    controls: Object.fromEntries(controls.map((c) => [c.code, c.id])),
    requirements: Object.fromEntries(
      requirements.map((r) => [`${r.frameworkVersion.key} ${r.ref}`, r.id]),
    ),
  };
}

function loaderOf(actor: DemoActor): LoaderIdentity | null {
  return "cli" in actor
    ? null
    : {
        email: actor.email,
        idpIssuer: actor.idpIssuer,
        idpSubject: actor.idpSubject,
      };
}

/** createMany in slices, so a table never nears the driver's bind-parameter limit. */
const SLICE = 400;
async function insert<T>(
  rows: readonly T[],
  write: (data: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += SLICE) await write(rows.slice(i, i + SLICE));
}

/** Parents before children: every table of the plan, in an order its foreign keys allow. */
async function writeRows(tx: Prisma.TransactionClient, r: SampleRows): Promise<void> {
  await insert(r.users, (data) => tx.user.createMany({ data }));
  await insert(r.organisation, (data) => tx.organisation.createMany({ data }));
  await insert(r.sites, (data) => tx.site.createMany({ data }));
  await insert(r.departments, (data) => tx.department.createMany({ data }));
  await insert(r.organisationFrameworks, (data) => tx.organisationFramework.createMany({ data }));
  await insert(r.riskScales, (data) => tx.riskScale.createMany({ data }));
  await insert(r.riskScaleLevels, (data) => tx.riskScaleLevel.createMany({ data }));
  await insert(r.roleAssignments, (data) => tx.roleAssignment.createMany({ data }));
  await insert(r.assets, (data) => tx.asset.createMany({ data }));
  await insert(r.risks, (data) => tx.risk.createMany({ data }));
  await insert(r.riskVersions, (data) => tx.riskVersion.createMany({ data }));
  await insert(r.riskAssets, (data) => tx.riskAsset.createMany({ data }));
  await insert(r.riskControls, (data) => tx.riskControl.createMany({ data }));
  await insert(r.approvals, (data) => tx.approval.createMany({ data }));
  await insert(r.tasks, (data) => tx.task.createMany({ data }));
  await insert(r.evidence, (data) => tx.evidence.createMany({ data }));
  await insert(r.evidenceControls, (data) => tx.evidenceControl.createMany({ data }));
  await insert(r.controlTests, (data) => tx.controlTest.createMany({ data }));
  await insert(r.controlTestEvidence, (data) => tx.controlTestEvidence.createMany({ data }));
  await insert(r.requirementApplicability, (data) =>
    tx.requirementApplicability.createMany({ data }),
  );
  await insert(r.boardNarratives, (data) => tx.boardNarrative.createMany({ data }));
  await insert(r.auditEvents, (data) => tx.auditEvent.createMany({ data }));
}

/**
 * Resets, then loads a year of sample activity, in ONE transaction on the owner connection:
 * the demo lock and the reset (`resetRows`: truncate, library sync, `demo.reset`), every
 * sample table, the Risk reference sequence, and `demo.sample_loaded` last. A failure rolls
 * back to the previous state, and a sign-in during the load waits on the truncate's locks and
 * then claims its placeholder. The trail reads: backdated history, `demo.reset` at the real
 * time, `demo.sample_loaded` newest.
 *
 * After the commit: wipe the evidence files, put the sample's (a failure is counted in
 * `evidenceFailed`; the row stays and the download 404s like any missing object), then end
 * every session, drain the queues and enqueue the library embedding.
 */
export async function loadSample(
  ownerDb: PrismaClient,
  ports: DemoPorts,
  actor: DemoActor,
  opts: { now: Date; bootstrapEmail: string | null },
): Promise<{
  risks: number;
  people: number;
  ms: number;
  evidenceFailed: number;
}> {
  const started = Date.now();
  const plan = planSampleYear(opts.now);

  const rows = await ownerDb.$transaction(async (tx) => {
    const reset = await resetRows(tx, actor);
    const rows = rowsFor(plan, {
      now: opts.now,
      library: await loadLibraryIds(tx),
      loader: loaderOf(actor),
      bootstrapEmail: opts.bootstrapEmail,
    });
    await writeRows(tx, rows);
    // Rows carry explicit references; move the serial past them (the next report is n + 1).
    // This is the only serial column in the schema.
    await tx.$executeRaw`SELECT setval(pg_get_serial_sequence('"Risk"', 'reference'),
      COALESCE((SELECT max(reference) FROM "Risk"), 1), (SELECT count(*) > 0 FROM "Risk"))`;
    // After the reset event, and after every other event of the trail.
    await tx.auditEvent.create({
      data: {
        occurredAt: new Date(Math.max(Date.now(), reset.occurredAt.getTime() + 1)),
        actorUserId: null,
        action: "demo.sample_loaded",
        objectType: "instance",
        objectId: "instance",
        afterRef: {
          actorEmail: actor.email,
          risks: rows.risks.length,
          people: rows.users.length,
        },
        requestId: "demo:sample_loaded",
      },
    });
    return rows;
  }, DEMO_TRANSACTION_OPTIONS);

  await ports.wipeEvidence();
  let evidenceFailed = 0;
  for (const object of rows.evidenceObjects) {
    try {
      await ports.putEvidence(object.key, object.body, object.contentType);
    } catch {
      evidenceFailed += 1;
    }
  }
  await ports.wipeSessions();
  await ports.drainQueues();
  await ports.enqueueLibraryEmbed();
  return {
    risks: rows.risks.length,
    people: rows.users.length,
    ms: Date.now() - started,
    evidenceFailed,
  };
}
