/**
 * Local runs only (`dev`, and `start` for the e2e suite): loads the repository's root .env
 * (variables already set in the shell win), then runs the Next.js CLI with the remaining
 * arguments. The container image runs the standalone server with its own environment. `node --env-file` cannot be used here:
 * `next dev` passes Node flags to its server process through NODE_OPTIONS, where Node
 * rejects --env-file.
 */
import { existsSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const envFile = new URL("../../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

await import("next/dist/bin/next");
