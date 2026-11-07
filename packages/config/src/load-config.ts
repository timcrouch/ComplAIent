import type { z } from "zod";

/** Exit code for configuration errors (EX_CONFIG, sysexits.h). */
const EXIT_CONFIG = 78;

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

// Messages are derived from issue.code only: zod's own messages may echo input.
function describe(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? "is required" : "has the wrong type";
    case "too_small":
      return "is too short or too small";
    case "too_big":
      return "is too long or too large";
    case "invalid_format":
      return "has an invalid format";
    case "invalid_value":
      return "is not one of the allowed values";
    case "custom":
      // Only hand-written ctx.addIssue messages reach here; they must never echo the input.
      return issue.message;
    default:
      return "is invalid";
  }
}

export function loadConfig<S extends z.ZodObject>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join(".") || "(config)";
    return `${name}: ${describe(issue)}`;
  });
  throw new ConfigError(problems);
}

export function formatConfigErrorAndExit(err: unknown): never {
  const message = err instanceof Error ? err.message : "Invalid configuration";
  process.stderr.write(`${message}\n`);
  return process.exit(EXIT_CONFIG);
}
