import { resetInstance } from "../reset.js";
import { confirmRun } from "./guard.js";
import { cliContext, guardInput, run } from "./shared.js";

run(async () => {
  const { db, ports, actor, databaseName } = cliContext();
  try {
    await confirmRun("reset", databaseName, guardInput());
    const started = Date.now();
    console.log(`Resetting "${databaseName}" (all data and settings are deleted)...`);
    await resetInstance(db, ports, actor);
    console.log(`Reset done in ${String(Date.now() - started)} ms.`);
  } finally {
    await db.$disconnect();
  }
});
