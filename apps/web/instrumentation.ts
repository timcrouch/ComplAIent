/** Runs once when the Next.js server starts: fail fast on invalid configuration. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./lib/env");
  env();
}
