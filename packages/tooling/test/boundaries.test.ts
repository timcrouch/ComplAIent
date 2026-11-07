import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = join(root, "packages/ui/src/__fixture__.ts");

function depcruise(): { status: number | null; output: string } {
  const result = spawnSync(
    "pnpm",
    ["exec", "depcruise", ".", "--config", ".dependency-cruiser.cjs"],
    { cwd: root, encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

let createdUiDir: string | undefined;

function cleanup(): void {
  rmSync(fixture, { force: true });
  if (createdUiDir !== undefined) {
    rmSync(join(root, "packages/ui"), { recursive: true, force: true });
    createdUiDir = undefined;
  }
}

describe("dependency boundaries", () => {
  afterEach(cleanup);

  it("flags packages/ui importing @isms/database with rule ui-no-backend", () => {
    createdUiDir = existsSync(join(root, "packages/ui")) ? undefined : "packages/ui";
    mkdirSync(dirname(fixture), { recursive: true });
    writeFileSync(fixture, 'import "@isms/database";\nexport {};\n');
    const violating = depcruise();
    expect(violating.status).not.toBe(0);
    expect(violating.output).toContain("ui-no-backend");

    cleanup();
    const clean = depcruise();
    expect(clean.output).not.toContain("ui-no-backend");
    expect(clean.status).toBe(0);
    // Two full depcruise runs over the monorepo; slower CI runners exceed the 5 s default.
  }, 60_000);
});
