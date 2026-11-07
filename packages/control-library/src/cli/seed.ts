import { databaseOwnerConfig, databaseTestConfig, loadConfig } from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { loadLibrary } from "../load.js";
import { syncControlLibrary } from "../sync.js";
import { coverageGaps, validateLibrary } from "../validate.js";

async function main(): Promise<number> {
  const test = process.argv.includes("--test");
  const url = test
    ? loadConfig(databaseTestConfig).DATABASE_OWNER_TEST_URL
    : loadConfig(databaseOwnerConfig).DATABASE_OWNER_URL;

  const lib = loadLibrary();
  const issues = validateLibrary(lib);
  if (issues.length > 0) {
    console.error(`Control library ${lib.libraryVersion} has ${String(issues.length)} issue(s):`);
    for (const issue of issues) console.error(`  [${issue.rule}] ${issue.message}`);
    return 1;
  }

  const db = createPrismaClient(url);
  try {
    const summary = await syncControlLibrary(db, lib);
    console.log(`Control library ${summary.libraryVersion} synced.`);
    console.log(
      `  frameworks ${String(summary.frameworks)}, requirements ${String(summary.requirements)}, groups ${String(summary.groups)}, controls ${String(summary.controls)}`,
    );
    for (const [version, count] of Object.entries(summary.requirementsByVersion)) {
      console.log(`    ${version}: ${String(count)} requirements`);
    }
    console.log(
      `  mappings created ${String(summary.mappingsCreated)}, mappings no longer in the content ${String(summary.orphanedMappings)}`,
    );
    for (const gap of coverageGaps(lib)) {
      console.warn(`  warning: no control covers ${gap.framework} ${gap.ref}`);
    }
  } finally {
    await db.$disconnect();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exit(1);
  },
);
