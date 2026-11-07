import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchVerifiedFiles,
  MODEL_FILES,
  MODEL_REPO,
  MODEL_REVISION,
  modelDirectory,
  ModelIntegrityError,
  modelUrl,
  verifyFiles,
} from "../src/model-files.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const FILES = [
  { path: "config.json", sha256: sha("{}") },
  { path: "onnx/model.onnx", sha256: sha("weights") },
];
const BODIES: Record<string, string> = { "config.json": "{}", "onnx/model.onnx": "weights" };

function fakeFetch(bodies: Record<string, string> = BODIES) {
  const urls: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const file = Object.keys(bodies).find((path) => url.endsWith(`/${path}`));
    if (file === undefined) return Promise.resolve(new Response("missing", { status: 404 }));
    return Promise.resolve(new Response(bodies[file]));
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const tempDir = () => mkdtemp(join(tmpdir(), "isms-model-"));

describe("model files", () => {
  it("pins the model to a commit and lists every file with its sha256", () => {
    expect(MODEL_REPO).toBe("Xenova/all-MiniLM-L6-v2");
    expect(MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(MODEL_FILES.map((f) => f.path).sort()).toEqual([
      "config.json",
      "onnx/model.onnx",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    for (const f of MODEL_FILES) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(modelUrl("onnx/model.onnx")).toBe(
      `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/onnx/model.onnx`,
    );
    expect(modelDirectory("/cache")).toBe(`/cache/${MODEL_REPO}/${MODEL_REVISION}`);
  });

  it("downloads each file, checks its sha256 and writes it", async () => {
    const dir = await tempDir();
    const { fetchImpl, urls } = fakeFetch();
    await fetchVerifiedFiles({ dir, files: FILES, urlFor: (p) => `https://x/${p}`, fetchImpl });
    expect(urls).toEqual(["https://x/config.json", "https://x/onnx/model.onnx"]);
    expect(await readFile(join(dir, "onnx/model.onnx"), "utf8")).toBe("weights");
    await expect(verifyFiles(dir, FILES)).resolves.toBeUndefined();
  });

  it("fails on a mismatched file and leaves nothing behind for it", async () => {
    const dir = await tempDir();
    const { fetchImpl } = fakeFetch({ ...BODIES, "onnx/model.onnx": "tampered" });
    await expect(
      fetchVerifiedFiles({ dir, files: FILES, urlFor: (p) => `https://x/${p}`, fetchImpl }),
    ).rejects.toThrow(ModelIntegrityError);
    expect(await readdir(join(dir, "onnx")).catch(() => [])).toEqual([]);
  });

  it("fails when a download is refused", async () => {
    const dir = await tempDir();
    const { fetchImpl } = fakeFetch({ "config.json": "{}" });
    await expect(
      fetchVerifiedFiles({ dir, files: FILES, urlFor: (p) => `https://x/${p}`, fetchImpl }),
    ).rejects.toThrow(/404/);
  });

  it("does not fetch files that are already present and verified", async () => {
    const dir = await tempDir();
    await fetchVerifiedFiles({
      dir,
      files: FILES,
      urlFor: (p) => `https://x/${p}`,
      ...fakeFetch(),
    });
    const second = fakeFetch();
    await fetchVerifiedFiles({ dir, files: FILES, urlFor: (p) => `https://x/${p}`, ...second });
    expect(second.urls).toEqual([]);
  });

  it("verification fails for a missing or altered file", async () => {
    const dir = await tempDir();
    await expect(verifyFiles(dir, FILES)).rejects.toThrow(ModelIntegrityError);
    await mkdir(join(dir, "onnx"), { recursive: true });
    await writeFile(join(dir, "config.json"), "{}");
    await writeFile(join(dir, "onnx/model.onnx"), "altered");
    await expect(verifyFiles(dir, FILES)).rejects.toThrow(/onnx\/model\.onnx/);
  });
});
