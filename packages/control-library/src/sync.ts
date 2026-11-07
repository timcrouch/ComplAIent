import type { Prisma, PrismaClient } from "@isms/database";
import type { LibraryContent } from "./schema.js";

export type SyncSummary = {
  libraryVersion: string;
  frameworks: number;
  requirements: number;
  requirementsByVersion: Record<string, number>;
  /** Requirement groups in the content, all levels. */
  groups: number;
  controls: number;
  mappingsCreated: number;
  /** Mappings in the database that the content no longer lists. Kept, never deleted. */
  orphanedMappings: number;
};

/**
 * Owner-run, one transaction, never deletes (a group the content drops stays, unused). Upserts
 * each version's groups before its requirements and links each requirement to its group. Updates
 * library text, never `Requirement.fullText`
 * and never a mapping's review. New mappings start unreviewed.
 */
export async function syncControlLibrary(
  db: PrismaClient | Prisma.TransactionClient,
  lib: LibraryContent,
): Promise<SyncSummary> {
  // Given a transaction client (the demo reset syncs inside its own transaction), join it.
  if (!("$transaction" in db)) return syncIn(db, lib);
  return db.$transaction((tx) => syncIn(tx, lib), { timeout: 60_000 });
}

async function syncIn(tx: Prisma.TransactionClient, lib: LibraryContent): Promise<SyncSummary> {
  const requirementIds = new Map<string, string>();
  const requirementsByVersion: Record<string, number> = {};
  let requirements = 0;
  let groups = 0;

  for (const file of lib.frameworks) {
    const { framework, version } = file;
    const fw = await tx.framework.upsert({
      where: { key: framework.key },
      create: framework,
      update: {
        name: framework.name,
        publisher: framework.publisher,
        summary: framework.summary,
      },
    });
    const fv = await tx.frameworkVersion.upsert({
      where: { key: version.key },
      create: { ...version, frameworkId: fw.id },
      update: { label: version.label, frameworkId: fw.id },
    });
    // Groups list each parent before its children (validateLibrary), so parents exist first.
    const groupIds = new Map<string, string>();
    for (const [sortOrder, { key, title, parent }] of (file.groups ?? []).entries()) {
      const parentId = parent === undefined ? null : groupIds.get(parent);
      if (parentId === undefined)
        throw new Error(`Unknown parent group ${version.key} ${parent ?? ""}`);
      const row = await tx.requirementGroup.upsert({
        where: { frameworkVersionId_key: { frameworkVersionId: fv.id, key } },
        create: { frameworkVersionId: fv.id, key, title, parentId, sortOrder },
        update: { title, parentId, sortOrder },
      });
      groupIds.set(key, row.id);
    }
    groups += groupIds.size;

    for (const [sortOrder, { ref, title, group }] of file.requirements.entries()) {
      const groupId = group === undefined ? null : groupIds.get(group);
      if (groupId === undefined)
        throw new Error(`Unknown group ${version.key} ${group ?? ""} (${ref})`);
      const row = await tx.requirement.upsert({
        where: { frameworkVersionId_ref: { frameworkVersionId: fv.id, ref } },
        create: { frameworkVersionId: fv.id, ref, title, sortOrder, groupId },
        update: { title, sortOrder, groupId },
      });
      requirementIds.set(`${version.key}\u0000${ref}`, row.id);
    }
    requirementsByVersion[version.key] = file.requirements.length;
    requirements += file.requirements.length;
  }

  const wanted = new Set<string>();
  const toCreate: { controlId: string; requirementId: string }[] = [];
  for (const c of lib.controls) {
    const data = {
      title: c.title,
      description: c.description,
      guidance: c.guidance,
      category: c.category,
      libraryVersion: lib.libraryVersion,
    };
    const control = await tx.control.upsert({
      where: { code: c.code },
      create: { code: c.code, ...data },
      update: data,
    });
    for (const m of c.mappings) {
      const requirementId = requirementIds.get(`${m.framework}\u0000${m.ref}`);
      if (!requirementId)
        throw new Error(`Unknown requirement ${m.framework} ${m.ref} (${c.code})`);
      wanted.add(`${control.id}\u0000${requirementId}`);
      toCreate.push({ controlId: control.id, requirementId });
    }
  }

  const { count: mappingsCreated } = await tx.controlRequirementMapping.createMany({
    data: toCreate,
    skipDuplicates: true,
  });

  const existing = await tx.controlRequirementMapping.findMany({
    select: { controlId: true, requirementId: true },
  });
  const orphanedMappings = existing.filter(
    (m) => !wanted.has(`${m.controlId}\u0000${m.requirementId}`),
  ).length;

  return {
    libraryVersion: lib.libraryVersion,
    frameworks: lib.frameworks.length,
    requirements,
    requirementsByVersion,
    groups,
    controls: lib.controls.length,
    mappingsCreated,
    orphanedMappings,
  };
}
