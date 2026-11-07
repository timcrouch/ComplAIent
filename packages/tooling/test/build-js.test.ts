import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../build-js.mjs");

let dir = "";

function write(path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function run(command: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(command, args, { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "isms-build-js-"));
  write("package.json", JSON.stringify({ type: "module" }));
  write(
    "src/index.ts",
    [
      'import { Service } from "./nested/service.js";',
      "const service: Service = new Service();",
      "console.log(service.greet());",
    ].join("\n"),
  );
  write(
    "src/nested/service.ts",
    [
      "const Injectable = (): ClassDecorator => () => {};",
      "class Clock { now(): number { return 1; } }",
      "@Injectable()",
      "export class Service {",
      "  constructor(private readonly clock: Clock = new Clock()) {}",
      "  greet(): string { return `hello ${String(this.clock.now())}`; }",
      "}",
    ].join("\n"),
  );
  write("src/ambient.d.ts", "declare const x: number;");
  write("src/index.test.ts", "throw new Error('tests are not compiled');");
  write("dist/stale.js", "stale");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("build-js", () => {
  it("compiles src to runnable ESM in dist, keeping .js specifiers", () => {
    const build = run("node", [script]);
    expect(build.output).toContain("compiled 2 files");
    expect(build.status).toBe(0);

    const result = run("node", ["dist/index.js"]);
    expect(result.output.trim()).toBe("hello 1");
    expect(result.status).toBe(0);
  });

  it("emits decorator metadata for NestJS dependency injection", () => {
    expect(run("node", [script]).status).toBe(0);
    const service = readFileSync(join(dir, "dist/nested/service.js"), "utf8");
    // The constructor's parameter types must name the injected class, which is what Nest
    // resolves; a bare "design:paramtypes" key would also appear for `Object`.
    expect(service).toMatch(
      /"design:paramtypes",\s*\[\s*typeof Clock === "undefined" \? Object : Clock\s*\]/,
    );
  });

  it("skips declaration files and tests, and clears stale output", () => {
    expect(run("node", [script]).status).toBe(0);
    expect(existsSync(join(dir, "dist/ambient.js"))).toBe(false);
    expect(existsSync(join(dir, "dist/ambient.d.js"))).toBe(false);
    expect(existsSync(join(dir, "dist/index.test.js"))).toBe(false);
    expect(existsSync(join(dir, "dist/stale.js"))).toBe(false);
  });

  it("fails when src holds no TypeScript to compile", () => {
    rmSync(join(dir, "src"), { recursive: true, force: true });
    const build = run("node", [script]);
    expect(build.status).not.toBe(0);
    expect(build.output).toContain("no TypeScript files");
  });

  it("fails with a non-zero exit on a syntax error", () => {
    write("src/broken.ts", "export const = ;");
    const build = run("node", [script]);
    expect(build.status).not.toBe(0);
    expect(build.output).toContain("broken.ts");
  });
});
