/** What the guard reads from the process (passed in, so it can be tested without one). */
export type GuardInput = {
  /** The command's own arguments (`process.argv.slice(2)`). */
  argv: readonly string[];
  nodeEnv: string | undefined;
  /** Both stdin and stdout are a terminal, so a person can answer. */
  isTTY: boolean;
  /** Asks one question on the terminal and resolves with the answer. */
  ask: (question: string) => Promise<string>;
};

export type CliAction = "load" | "reset";

const OPTIONS = ["--yes", "-y", "--allow-production"] as const;

const QUESTIONS: Record<CliAction, (db: string) => string> = {
  load: (db) =>
    `Replace everything in "${db}" with the sample data? This deletes all data and settings and cannot be undone. [y/N] `,
  reset: (db) => `Delete all data and settings in "${db}"? This cannot be undone. [y/N] `,
};

/**
 * The guard in front of `pnpm demo:load` and `pnpm demo:reset` (#7), which erase the whole
 * instance. Refuses an unknown option (a typo must not skip the question) and
 * NODE_ENV=production unless `--allow-production` is given. Then asks for a y/N confirmation,
 * which `--yes` (`-y`) skips; without a terminal, and so without anyone to answer, it refuses
 * unless `--yes` is given. Throws with the reason when the command must not run.
 */
export async function confirmRun(
  action: CliAction,
  databaseName: string,
  input: GuardInput,
): Promise<void> {
  const args = input.argv.filter((a) => a !== "--");
  const unknown = args.find((a) => !(OPTIONS as readonly string[]).includes(a));
  if (unknown !== undefined) {
    throw new Error(`Unknown option "${unknown}". Options: --yes, --allow-production.`);
  }
  if (input.nodeEnv === "production" && !args.includes("--allow-production")) {
    throw new Error(
      "Refusing to run: NODE_ENV=production. Pass --allow-production if you really mean to erase this instance.",
    );
  }
  if (args.includes("--yes") || args.includes("-y")) return;
  if (!input.isTTY) {
    throw new Error(
      "Refusing to run without confirmation: not an interactive terminal. Pass --yes to confirm.",
    );
  }
  const answer = (await input.ask(QUESTIONS[action](databaseName))).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") throw new Error("Cancelled: nothing was changed.");
}
