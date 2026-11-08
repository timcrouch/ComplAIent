import { createInterface } from "node:readline/promises";
import {
  bootstrapConfig,
  databaseOwnerConfig,
  loadConfig,
  redisConfig,
  storageConfig,
} from "@isms/config";
import { createPrismaClient } from "@isms/database";
import { createDefaultPorts, type DemoActor, type DemoPorts } from "../ports.js";
import type { GuardInput } from "./guard.js";

export type CliContext = {
  db: ReturnType<typeof createPrismaClient>;
  ports: DemoPorts;
  actor: DemoActor;
  bootstrapEmail: string | null;
  databaseName: string;
};

/** Refuses unless DEMO_TOOLS_ENABLED=true: these commands erase the whole instance. */
export function cliContext(): CliContext {
  if (process.env.DEMO_TOOLS_ENABLED !== "true") {
    throw new Error("Refusing to run: set DEMO_TOOLS_ENABLED=true to use the demo tools.");
  }
  const { DATABASE_OWNER_URL } = loadConfig(databaseOwnerConfig);
  const { REDIS_URL } = loadConfig(redisConfig);
  const s3 = loadConfig(storageConfig);
  const { BOOTSTRAP_ADMIN_EMAIL } = loadConfig(bootstrapConfig);
  return {
    db: createPrismaClient(DATABASE_OWNER_URL),
    ports: createDefaultPorts({ s3, redisUrl: REDIS_URL }),
    actor: { email: BOOTSTRAP_ADMIN_EMAIL ?? "cli", cli: true },
    bootstrapEmail: BOOTSTRAP_ADMIN_EMAIL ?? null,
    databaseName: decodeURIComponent(new URL(DATABASE_OWNER_URL).pathname.replace(/^\//, "")),
  };
}

/** The guard's view of this process: its arguments, NODE_ENV and the terminal. */
export function guardInput(): GuardInput {
  return {
    argv: process.argv.slice(2),
    nodeEnv: process.env.NODE_ENV,
    isTTY: process.stdin.isTTY && process.stdout.isTTY,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

export function run(main: () => Promise<void>): void {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : "Demo command failed");
      process.exit(1);
    },
  );
}
