#!/usr/bin/env node
/**
 * Compiles a package's `src/**\/*.ts` to `dist/**\/*.js` with SWC, for the production
 * container images only. Development and tests keep running the TypeScript source.
 *
 * Transpile only (no type check; `pnpm typecheck` does that). Keeps the NodeNext-style `.js`
 * specifiers, so the output runs on plain Node. Legacy decorators with metadata match what
 * NestJS dependency injection needs and what `@swc-node/register` does in development.
 *
 * Run from the package directory: `isms-build-js` (the `build` script).
 */
import { glob, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { transformFile } from "@swc/core";

const SRC = "src";
const OUT = "dist";

/** @type {import("@swc/core").Options} */
const options = {
  swcrc: false,
  configFile: false,
  sourceMaps: false,
  module: { type: "es6" },
  jsc: {
    target: "es2022",
    keepClassNames: true,
    parser: { syntax: "typescript", decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
};

await rm(OUT, { recursive: true, force: true });

let count = 0;
try {
  for await (const file of glob(`${SRC}/**/*.ts`, {
    exclude: (name) => name.endsWith(".d.ts") || name.endsWith(".test.ts"),
  })) {
    const target = join(OUT, file.slice(SRC.length + 1).replace(/\.ts$/, ".js"));
    const { code } = await transformFile(file, { ...options, filename: file });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, code);
    count += 1;
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

// An empty build means a wrong directory or a broken glob: fail rather than ship nothing.
if (count === 0) {
  process.stderr.write(`build-js: no TypeScript files found in ${SRC}\n`);
  process.exit(1);
}

process.stdout.write(`build-js: compiled ${String(count)} files from ${SRC} to ${OUT}\n`);
