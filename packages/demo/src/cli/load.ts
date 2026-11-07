import { loadSample } from "../load.js";
import { cliContext, run } from "./shared.js";

run(async () => {
  const { db, ports, actor, bootstrapEmail, databaseName } = cliContext();
  try {
    console.log(`Loading sample data into "${databaseName}" (everything there is replaced)...`);
    const result = await loadSample(db, ports, actor, {
      now: new Date(),
      bootstrapEmail,
    });
    console.log(
      `Loaded ${String(result.risks)} risks and ${String(result.people)} people in ${String(result.ms)} ms.`,
    );
    if (result.evidenceFailed > 0) {
      console.warn(`${String(result.evidenceFailed)} evidence file(s) could not be stored.`);
    }
  } finally {
    await db.$disconnect();
  }
});
